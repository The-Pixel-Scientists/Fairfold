// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit log search through the whole API against the test database, as
// app_api: filters in a body, the subject party on each event, the strict
// body, and tenant isolation.

import { randomUUID } from 'node:crypto';

import { insertAuditEvent, type AuditEventRow } from '@pixel-scientists/db';
import type { AuditSearchPage } from '@pixel-scientists/domain/platform/audit-log';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import {
  captureLogs,
  smtpTestSettings,
  tenantId,
  testAuth,
  testSession,
} from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { loadConfig } from '../../config.ts';
import { openDatabase, type ApiDatabase } from '../../database.ts';
import { createLogger } from '../../logger.ts';
import { composeModules } from '../../modules.ts';
import { PAGE_SIZE } from './handler.ts';

interface Member {
  readonly userId: string;
  readonly membershipId: string;
  readonly tenant: TestTenant;
}

let api: FastifyInstance;
let database: ApiDatabase;
const auth = testAuth();
const logs = captureLogs();

let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let managerA: Member;
let reviewerA: Member;
let adminB: Member;
let personA: string;
let personB: string;
const entityOfPerson = randomUUID();
const entityOther = randomUUID();

async function addMember(tenant: TestTenant, role: string): Promise<Member> {
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles: [role] }),
  );
  return { userId, membershipId, tenant };
}

const eventRow = (row: Partial<AuditEventRow>): AuditEventRow => ({
  requestId: randomUUID(),
  actorKind: 'system',
  actorId: null,
  action: 'platform.tenant.updated',
  entityType: 'platform.tenant',
  entityId: randomUUID(),
  changes: {},
  ...row,
});

const record = (tenant: TestTenant, row: Partial<AuditEventRow>): Promise<void> =>
  database.inTenant(tenantId(tenant.id), (tx) => insertAuditEvent(tx, eventRow(row)));

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41003',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'info', destination: logs.stream });
  database = openDatabase(settings, logger);

  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'tenant_admin');
  managerA = await addMember(tenantA, 'programme_manager');
  reviewerA = await addMember(tenantA, 'reviewer');
  adminB = await addMember(tenantB, 'tenant_admin');
  [personA, personB] = await Promise.all([
    asMigratorIn(tenantA.id, (client) => addPerson(client, tenantA)),
    asMigratorIn(tenantB.id, (client) => addPerson(client, tenantB)),
  ]);

  await record(tenantA, {
    actorKind: 'user',
    actorId: adminA.membershipId,
    action: 'platform.person.erased',
    entityType: 'platform.person',
    entityId: entityOfPerson,
    subjectPartyId: personA,
  });
  await record(tenantA, { entityId: entityOther });
  await record(tenantB, {
    action: 'platform.person.erased',
    entityType: 'platform.person',
    subjectPartyId: personB,
  });

  api = await buildApp({
    logger,
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    auth: auth.module,
    ...composeModules({ publicTenants: database.publicTenants }),
  });
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

const search = (member: Member, body: unknown) =>
  api.inject({
    method: 'POST',
    url: '/api/console/audit-events/search',
    headers: auth.as({
      app: 'console',
      session: testSession({ app: 'console', userId: member.userId, tenant: member.tenant.id }),
    }),
    payload: body as Record<string, unknown>,
  });

async function page(member: Member, body: unknown = {}): Promise<AuditSearchPage> {
  const response = await search(member, body);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<AuditSearchPage>();
}

const eventCount = (tenant: TestTenant): Promise<number> =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<{ n: string }>('SELECT count(*) AS n FROM app.audit_event');
    return Number(rows[0]?.n);
  });

describe('who may search', () => {
  it('lets only a holder of platform.audit.read in', async () => {
    expect((await search(adminA, {})).statusCode).toBe(200);
    for (const member of [managerA, reviewerA]) {
      expect((await search(member, {})).statusCode, member.membershipId).toBe(403);
    }
    const signedOut = await api.inject({
      method: 'POST',
      url: '/api/console/audit-events/search',
      payload: {},
    });
    expect(signedOut.statusCode).toBe(401);
  });
});

describe('what a search returns', () => {
  it('puts each event subject party on it as an id, or null', async () => {
    const { events } = await page(adminA);

    expect(events.map((event) => [event.entityId, event.subjectPartyId])).toEqual([
      [entityOther, null],
      [entityOfPerson, personA],
    ]);
    expect(events[1]?.actor).toMatchObject({ kind: 'staff', membershipId: adminA.membershipId });
  });

  it('filters by subject party, actor, action, entity and module, all from the body', async () => {
    const ids = async (body: unknown) => (await page(adminA, body)).events.map((e) => e.entityId);

    expect(await ids({ subjectPartyId: personA })).toEqual([entityOfPerson]);
    expect(await ids({ byMembershipId: adminA.membershipId })).toEqual([entityOfPerson]);
    expect(await ids({ action: 'platform.person.erased' })).toEqual([entityOfPerson]);
    expect(await ids({ entityType: 'platform.person', entityId: entityOfPerson })).toEqual([
      entityOfPerson,
    ]);
    expect(await ids({ module: 'grants' })).toEqual([]);
    expect(await ids({ subjectPartyId: personA, action: 'platform.tenant.updated' })).toEqual([]);
  });

  it('answers an unknown id, or another tenant one, with an empty page', async () => {
    for (const body of [
      { subjectPartyId: randomUUID() },
      { subjectPartyId: personB },
      { byMembershipId: adminB.membershipId },
      { entityId: randomUUID() },
    ]) {
      const response = await search(adminA, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(200);
      expect(response.json<AuditSearchPage>()).toEqual({ events: [], nextCursor: null });
    }
  });

  it('pages newest first with the cursor and the filters kept', async () => {
    const tenant = await createTestTenant();
    const admin = await addMember(tenant, 'tenant_admin');
    const person = await asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
    await database.inTenant(tenantId(tenant.id), async (tx) => {
      for (let n = 0; n < PAGE_SIZE + 3; n += 1) {
        await insertAuditEvent(
          tx,
          eventRow({
            action: 'platform.person.erased',
            entityType: 'platform.person',
            subjectPartyId: person,
          }),
        );
      }
    });

    const first = await page(admin, { subjectPartyId: person });
    expect(first.events).toHaveLength(PAGE_SIZE);
    const second = await page(admin, { subjectPartyId: person, cursor: first.nextCursor });

    expect(second.events).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.events, ...second.events].map((event) => event.id);
    expect(new Set(seen).size).toBe(PAGE_SIZE + 3);
  });

  it('counts a day across a clock change in the tenant time zone, both ends included', async () => {
    const tenant = await createTestTenant();
    const admin = await addMember(tenant, 'tenant_admin');
    await asMigratorIn(tenant.id, async (client) => {
      await client.query(`UPDATE app.tenant SET timezone = 'Europe/London'`);
      // The clocks went forward at 01:00 UTC on 29 March 2026, so that day
      // ran from 00:00 UTC to 22:59:59 UTC.
      for (const at of [
        '2026-03-28T23:59:59Z',
        '2026-03-29T00:00:00Z',
        '2026-03-29T22:59:59Z',
        '2026-03-29T23:00:00Z',
      ]) {
        await insertRow(client, 'app.audit_event', {
          tenant_id: tenant.id,
          request_id: randomUUID(),
          actor_kind: 'system',
          action: 'platform.tenant.updated',
          entity_type: 'platform.tenant',
          entity_id: randomUUID(),
          changes: {},
          occurred_at: at,
        });
      }
    });

    const times = (await page(admin, { from: '2026-03-29', to: '2026-03-29' })).events.map(
      (event) => event.occurredAt,
    );

    expect(times).toEqual(['2026-03-29T22:59:59.000Z', '2026-03-29T00:00:00.000Z']);
  });
});

describe('what a search refuses', () => {
  it('refuses a key the contract lacks, a bad value and a bad cursor, with no internals', async () => {
    for (const body of [
      { tenantId: tenantB.id },
      { limit: 1000 },
      { module: 'nothing' },
      { entityId: '1' },
      { subjectPartyId: 'nope' },
      { from: '2026-02-31' },
      { cursor: '!' },
      { cursor: Buffer.from('nonsense').toString('base64url') },
    ]) {
      const response = await search(adminA, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.body, JSON.stringify(body)).not.toMatch(/node_modules|\.ts:|select /i);
    }
  });
});

describe('isolation and privacy', () => {
  it('never returns another tenant events, whatever the filters', async () => {
    const own = await page(adminB);
    expect(own.events.map((event) => event.subjectPartyId)).toEqual([personB]);

    for (const body of [
      { subjectPartyId: personA },
      { entityId: entityOfPerson },
      { byMembershipId: adminA.membershipId },
      { action: 'platform.tenant.updated' },
      { module: 'platform', from: '2000-01-01', to: '2100-01-01' },
    ]) {
      const { events } = await page(adminB, body);
      expect(
        events.filter((event) => event.subjectPartyId !== personB),
        JSON.stringify(body),
      ).toEqual([]);
    }
  });

  it('is not audited, and its filters reach no log line', async () => {
    const before = await eventCount(tenantA);
    await page(adminA, { subjectPartyId: personA });

    expect(await eventCount(tenantA)).toBe(before);
    expect(logs.text()).not.toContain(personA);
  });
});
