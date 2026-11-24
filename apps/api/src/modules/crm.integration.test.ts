// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crm routes through the whole API against the test database, as app_api:
// sessions, the policy, the module switch, row-level security, replays and the
// audit log, for two tenants. The handlers' own rules are tested with crm.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import { asMigratorIn, createTestTenant } from '../../../../packages/db/test/tenants.ts';
import { switchModule } from '../../test/modules-on.ts';
import { rowsOf } from '../../test/programme-api.ts';
import { addMember, events, type Member } from '../../test/settings-api.ts';
import { expectLooksMissing, smtpTestSettings, testAuth, testSession } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { loadConfig, Secret } from '../config.ts';
import { openDatabase } from '../database.ts';
import { createLogger } from '../logger.ts';
import { composeModules } from '../modules.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const NAME = 'Quillfeather';

const { database: settings } = loadConfig({
  ...process.env,
  ...smtpTestSettings,
  TPS_API_PORT: '41131',
  TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
});
const logger = createLogger({ level: 'silent' });
const database = openDatabase(settings, logger);
const auth = testAuth();
const api = await buildApp({
  logger,
  checkDatabase: () => database.check(),
  inTenant: database.inTenant,
  auth: auth.module,
  ...composeModules({
    publicTenants: database.publicTenants,
    settings: {
      crm: { previewSecret: new Secret('a-test-secret-that-is-at-least-32-bytes') },
      marketing: undefined,
      forms: undefined,
      assure: { registryKeys: {}, sanctionsListUrl: undefined },
    },
  }),
});

type Tenant = Awaited<ReturnType<typeof createTestTenant>>;

let tenantA: Tenant;
let tenantB: Tenant;
let tenantOff: Tenant;
let managerA: Member;
let reviewerA: Member;
let managerB: Member;
let managerOff: Member;

beforeAll(async () => {
  [tenantA, tenantB, tenantOff] = await Promise.all([
    createTestTenant(),
    createTestTenant(),
    createTestTenant(),
  ]);
  managerA = await addMember(tenantA, 'console', 'programme_manager');
  reviewerA = await addMember(tenantA, 'console', 'reviewer');
  managerB = await addMember(tenantB, 'console', 'programme_manager');
  managerOff = await addMember(tenantOff, 'console', 'programme_manager');
  await switchModule(tenantA, 'crm');
  await switchModule(tenantB, 'crm');
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** A request as `member`, with an idempotency key on a POST and a recent sign-in when asked. */
const send = (
  member: Member,
  method: Method,
  url: string,
  payload?: unknown,
  { key = randomUUID(), recent = false } = {},
) =>
  api.inject({
    method,
    url: `/api${url}`,
    headers: {
      ...(method === 'POST' ? { 'idempotency-key': key } : {}),
      ...auth.as({
        app: member.app,
        session: testSession({
          app: member.app,
          userId: member.userId,
          tenant: member.tenant.id,
          recentAuthAt: recent ? new Date() : null,
        }),
      }),
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function answer<T>(response: ReturnType<typeof send>, status = 200): Promise<T> {
  const answered = await response;
  expect(answered.statusCode, answered.body).toBe(status);
  return answered.json<T>();
}

const org = (tenant: Tenant, name: string) =>
  asMigratorIn(tenant.id, (client) => addOrganisation(client, tenant, { name }));
const person = (tenant: Tenant, change: Record<string, unknown> = {}) =>
  asMigratorIn(tenant.id, (client) => addPerson(client, tenant, change));
const count = async (tenant: Tenant, table: string) =>
  Number((await rowsOf<{ n: string }>(tenant, `SELECT count(*) AS n FROM ${table}`))[0]?.n);

describe('who may reach the crm routes', () => {
  it('refuses a member without the permission, and answers 404 for a tenant with crm off', async () => {
    expect((await send(reviewerA, 'POST', '/console/crm/search', { term: NAME })).statusCode).toBe(
      403,
    );
    const off = await send(managerOff, 'POST', '/console/crm/search', { term: NAME });
    expect(off.statusCode).toBe(404);
  });

  it('refuses a request with no session', async () => {
    const response = await api.inject({ method: 'GET', url: '/api/console/crm/lists' });
    expect(response.statusCode).toBe(401);
  });
});

describe('search and records', () => {
  it('finds a record in the tenant only, and reads its record, audited with the person as subject', async () => {
    const [harbour, ada] = [
      await org(tenantA, `${NAME} Gardens`),
      await person(tenantA, {
        given_name: 'Zephyrine',
        family_name: NAME,
        email: 'zq@example.test',
      }),
    ];
    await org(tenantB, `${NAME} Gardens Elsewhere`);

    const found = await answer<{ results: { id: string }[] }>(
      send(managerA, 'POST', '/console/crm/search', { term: NAME, limit: 25 }),
    );
    expect(found.results.map(({ id }) => id).sort()).toEqual([harbour, ada].sort());
    expect((await events(tenantA, 'crm.party.found')).map((e) => e.entity_id)).toContain(ada);

    await answer(send(managerA, 'GET', `/console/crm/organisations/${harbour}`));
    expect((await events(tenantA, 'crm.party.viewed')).map((e) => e.entity_id)).toContain(harbour);
  });

  it('answers another tenant’s record as it answers a missing one', async () => {
    const theirs = await org(tenantB, 'Elsewhere Trust');
    expectLooksMissing(
      await send(managerA, 'GET', `/console/crm/organisations/${theirs}`),
      await send(managerA, 'GET', `/console/crm/organisations/${randomUUID()}`),
    );
  });
});

describe('timeline', () => {
  it('records an interaction once for a repeated key, audits it, and keeps it out of other tenants', async () => {
    const harbour = await org(tenantA, 'Timeline Harbour');
    const body = {
      kind: 'note',
      occurredAt: '2026-11-01T10:00:00Z',
      summary: 'Spoke to the chair.',
    };
    const key = randomUUID();
    const url = `/console/crm/parties/${harbour}/interactions`;

    const first = await answer<{ id: string }>(send(managerA, 'POST', url, body, { key }), 201);
    const again = await answer<{ id: string }>(send(managerA, 'POST', url, body, { key }), 201);

    expect(again.id).toBe(first.id);
    expect(await count(tenantA, 'crm.interaction')).toBeGreaterThanOrEqual(1);
    expect(
      (await events(tenantA, 'crm.interaction.recorded')).filter((e) => e.entity_id === first.id),
    ).toHaveLength(1);
    const timeline = await answer<{ interactions: { id: string }[] }>(
      send(managerA, 'GET', `/console/crm/parties/${harbour}/timeline`),
    );
    expect(timeline.interactions.map(({ id }) => id)).toEqual([first.id]);
    expect(
      (await send(managerB, 'GET', `/console/crm/parties/${harbour}/timeline`)).statusCode,
    ).toBe(404);
    expect((await send(managerB, 'POST', url, body)).statusCode).toBe(404);
  });
});

describe('lists', () => {
  it('creates a list, adds and removes members, and replays each repeated key', async () => {
    const harbour = await org(tenantA, 'List Harbour');
    const key = randomUUID();
    const body = { name: `Funders ${randomUUID()}` };

    const list = await answer<{ id: string }>(
      send(managerA, 'POST', '/console/crm/lists', body, { key }),
      201,
    );
    const replayed = await answer<{ id: string }>(
      send(managerA, 'POST', '/console/crm/lists', body, { key }),
      201,
    );
    expect(replayed.id).toBe(list.id);
    expect(await events(tenantA, 'crm.list.created')).toContainEqual(
      expect.objectContaining({ entity_id: list.id }),
    );

    const members = `/console/crm/lists/${list.id}/members`;
    const change = { partyIds: [harbour] };
    const addKey = randomUUID();
    expect(await answer(send(managerA, 'POST', members, change, { key: addKey }))).toEqual({
      changed: 1,
      unchanged: 0,
    });
    expect(await answer(send(managerA, 'POST', members, change, { key: addKey }))).toEqual({
      changed: 0,
      unchanged: 1,
    });
    const read = await answer<{ members: { partyId: string }[] }>(send(managerA, 'GET', members));
    expect(read.members.map(({ partyId }) => partyId)).toEqual([harbour]);
    expect(await answer(send(managerA, 'POST', `${members}/removal`, change))).toEqual({
      changed: 1,
      unchanged: 0,
    });
  });

  it('keeps a list, and a party, inside the tenant', async () => {
    const list = await answer<{ id: string }>(
      send(managerA, 'POST', '/console/crm/lists', { name: `Private ${randomUUID()}` }),
      201,
    );
    const theirs = await org(tenantB, 'Their Harbour');

    expect((await send(managerB, 'GET', `/console/crm/lists/${list.id}/members`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await send(managerA, 'POST', `/console/crm/lists/${list.id}/members`, {
          partyIds: [theirs],
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    const names = await answer<{ lists: { id: string }[] }>(
      send(managerB, 'GET', '/console/crm/lists'),
    );
    expect(names.lists.map(({ id }) => id)).not.toContain(list.id);
  });
});

describe('segments', () => {
  it('saves a segment with its configuration version and audit event, and reads its members', async () => {
    const ada = await person(tenantA, { given_name: 'Seg', family_name: 'Person' });
    const body = {
      name: `People ${randomUUID()}`,
      filters: { [randomUUID()]: { field: 'kind', operator: 'eq', value: 'person' } },
    };
    const key = randomUUID();

    const segment = await answer<{ id: string; version: number }>(
      send(managerA, 'POST', '/console/crm/segments', body, { key }),
      201,
    );
    const replayed = await answer<{ id: string }>(
      send(managerA, 'POST', '/console/crm/segments', body, { key }),
      201,
    );

    expect(replayed.id).toBe(segment.id);
    expect(segment.version).toBe(1);
    const stored = await rowsOf<{ version: number; author_id: string }>(
      tenantA,
      `SELECT version, author_id FROM app.config_version
        WHERE entity_type = 'crm.segment' AND entity_id = $1`,
      [segment.id],
    );
    expect(stored).toEqual([{ version: 1, author_id: managerA.membershipId }]);
    expect(await events(tenantA, 'crm.segment.saved')).toContainEqual(
      expect.objectContaining({ entity_id: segment.id, actor_id: managerA.membershipId }),
    );
    const members = await answer<{ members: { partyId: string }[] }>(
      send(managerA, 'GET', `/console/crm/segments/${segment.id}/members`),
    );
    expect(members.members.map(({ partyId }) => partyId)).toContain(ada);
    expect((await send(managerB, 'GET', `/console/crm/segments/${segment.id}`)).statusCode).toBe(
      404,
    );
  });
});

describe('duplicates', () => {
  it('lists a pair in the tenant and never one that spans tenants', async () => {
    const [x, y] = [await org(tenantA, 'Dupewell Trust'), await org(tenantA, 'Dupewell Trust')];
    const other = await org(tenantB, 'Dupewell Trust');

    const found = await answer<{ pairs: { partyId: string; otherPartyId: string }[] }>(
      send(managerA, 'GET', `/console/crm/parties/${x}/duplicates`),
    );
    const ids = found.pairs.flatMap((pair) => [pair.partyId, pair.otherPartyId]);
    expect(ids).toEqual(expect.arrayContaining([x, y]));
    expect(ids).not.toContain(other);
    expect(
      (await send(managerA, 'GET', `/console/crm/parties/${other}/duplicates`)).statusCode,
    ).toBe(404);
    expect((await send(reviewerA, 'GET', `/console/crm/parties/${x}/duplicates`)).statusCode).toBe(
      403,
    );
  });
});

describe('merge', () => {
  it('needs a recent sign-in, previews with a signed token, audits the preview, and refuses a confirm while a module has no re-point', async () => {
    const [loser, survivor] = [
      await org(tenantA, 'Mergewell One'),
      await org(tenantA, 'Mergewell Two'),
    ];
    const choice = { loserId: loser, survivorId: survivor, kind: 'organisation' };

    expect((await send(managerA, 'POST', '/console/crm/merges/preview', choice)).statusCode).toBe(
      403,
    );
    const preview = await answer<{ token: string; conflicts: string[] }>(
      send(managerA, 'POST', '/console/crm/merges/preview', choice, { recent: true }),
    );
    expect(preview.token).toMatch(/^\d+\./);
    expect((await events(tenantA, 'crm.merge.previewed')).map((e) => e.entity_id)).toEqual(
      expect.arrayContaining([loser, survivor]),
    );

    // Grants, assure, forms and privacy hold party keys and register no re-point yet, so the
    // executor refuses every merge before it writes.
    expect(preview.conflicts).toEqual(['module_unregistered']);
    const confirmed = await send(
      managerA,
      'POST',
      '/console/crm/merges',
      { ...choice, token: preview.token },
      { recent: true },
    );
    expect(confirmed.statusCode).toBe(409);
    expect(await count(tenantA, 'crm.merge_record')).toBe(0);
    const [held] = await rowsOf<{ status: string }>(
      tenantA,
      'SELECT status FROM party.party WHERE id = $1',
      [loser],
    );
    expect(held?.status).toBe('active');
  });

  it('answers another tenant’s parties as missing', async () => {
    const [mine, theirs] = [await org(tenantA, 'Mine'), await org(tenantB, 'Theirs')];
    const response = await send(
      managerA,
      'POST',
      '/console/crm/merges/preview',
      { loserId: theirs, survivorId: mine, kind: 'organisation' },
      { recent: true },
    );
    expect(response.statusCode).toBe(404);
    expect(await count(tenantB, 'crm.merge_record')).toBe(0);
  });
});
