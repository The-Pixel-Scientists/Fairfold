// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The embed origin routes through the whole API against the test database, as
// app_api: who may change the list, the version and audit event each change
// writes, the cap of 20, two tenants, and the public read by slug.

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../../packages/db/test/tenants.ts';
import { addMember, events, versions, type Member } from '../../../../test/settings-api.ts';
import { smtpTestSettings, testAuth, testSession } from '../../../../test/support.ts';
import { buildApp } from '../../../app.ts';
import { loadConfig } from '../../../config.ts';
import { openDatabase, type ApiDatabase } from '../../../database.ts';
import { createLogger } from '../../../logger.ts';
import { composeModules } from '../../../modules.ts';

// Each request runs a few statements in a transaction, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let api: FastifyInstance;
let database: ApiDatabase;
let as: (member: Member) => Record<string, string>;
let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let managerA: Member;
let reviewerA: Member;
let applicantA: Member;
let adminB: Member;

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41006',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  database = openDatabase(settings, createLogger({ level: 'silent' }));
  const auth = testAuth();
  as = (member) =>
    auth.as({
      app: member.app,
      session: testSession({ app: member.app, userId: member.userId, tenant: member.tenant.id }),
    });
  api = await buildApp({
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    auth: auth.module,
    ...composeModules({ publicTenants: database.publicTenants }),
  });

  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'console', 'tenant_admin');
  managerA = await addMember(tenantA, 'console', 'programme_manager');
  reviewerA = await addMember(tenantA, 'console', 'reviewer');
  applicantA = await addMember(tenantA, 'portal', 'applicant');
  adminB = await addMember(tenantB, 'console', 'tenant_admin');
  // Embeds are offered by the forms module, so the public read needs it on.
  for (const [tenant, admin] of [
    [tenantA, adminA],
    [tenantB, adminB],
  ] as const) {
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.tenant_module', {
        tenant_id: tenant.id,
        module: 'forms',
        enabled: true,
        updated_by: admin.membershipId,
      }),
    );
  }
}, 90_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

const PATH = '/api/console/settings/embed-origins';

// Each test starts from empty lists, whatever the one before it left.
afterEach(async () => {
  for (const admin of [adminA, adminB]) {
    for (const { id } of await origins(admin)) await remove(admin, id);
  }
});

const list = (member: Member | undefined) =>
  api.inject({ url: PATH, ...(member && { headers: as(member) }) });
const add = (member: Member | undefined, origin: unknown, key = randomUUID()) =>
  api.inject({
    method: 'POST',
    url: PATH,
    headers: { ...(member && as(member)), 'idempotency-key': key },
    payload: { origin },
  });
const remove = (member: Member | undefined, id: string) =>
  api.inject({
    method: 'DELETE',
    url: `${PATH}/${id}`,
    ...(member && { headers: as(member) }),
  });
const publicRead = (slug: string) =>
  api.inject({ url: `/api/public/tenants/${slug}/embed-origins` });

const origins = async (member: Member) =>
  (await list(member)).json<{ origins: { id: string; origin: string }[] }>().origins;

describe('who may change the list', () => {
  it('refuses any other role, a portal session and a signed-out caller, and changes nothing', async () => {
    const id = randomUUID();
    for (const member of [managerA, reviewerA, applicantA]) {
      expect((await list(member)).statusCode).toBe(403);
      expect((await add(member, 'https://refused.example.org')).statusCode).toBe(403);
      expect((await remove(member, id)).statusCode).toBe(403);
    }
    expect((await list(undefined)).statusCode).toBe(401);
    expect((await add(undefined, 'https://refused.example.org')).statusCode).toBe(401);
    expect((await remove(undefined, id)).statusCode).toBe(401);

    expect(await origins(adminA)).toEqual([]);
    expect(await versions(tenantA, 'platform.embed_origins')).toEqual([]);
    expect(await events(tenantA, 'platform.embed_origin.added')).toEqual([]);
  });
});

describe('adding and removing an origin', () => {
  it('lists it, writes a version and an audit event, and shows it to the public read at once', async () => {
    const response = await add(adminA, '  HTTPS://Funder.Example.Org ');

    expect(response.statusCode).toBe(201);
    const { id } = response.json<{ id: string }>();
    expect(response.json()).toMatchObject({ origin: 'https://funder.example.org' });
    expect(await origins(adminA)).toMatchObject([{ id, origin: 'https://funder.example.org' }]);
    expect((await versions(tenantA, 'platform.embed_origins'))[0]).toMatchObject({
      version: 1,
      author_id: adminA.membershipId,
      entity_id: id,
      diff: { changes: [{ field: 'origin', from: null, to: 'https://funder.example.org' }] },
    });
    expect((await events(tenantA, 'platform.embed_origin.added'))[0]).toMatchObject({
      actor_id: adminA.membershipId,
      entity_id: id,
      changes: { 'app.embed_origin.origin': { after: 'https://funder.example.org' } },
    });
    const read = await publicRead(tenantA.slug);
    expect(read.json()).toEqual({ origins: ['https://funder.example.org'] });
    expect(read.headers['set-cookie']).toBeUndefined();

    expect((await remove(adminA, id)).statusCode).toBe(204);

    expect(await origins(adminA)).toEqual([]);
    expect((await publicRead(tenantA.slug)).statusCode).toBe(404);
    expect((await versions(tenantA, 'platform.embed_origins')).map((v) => v.version)).toEqual([
      1, 2,
    ]);
    expect((await events(tenantA, 'platform.embed_origin.removed'))[0]).toMatchObject({
      entity_id: id,
      changes: { 'app.embed_origin.origin': { before: 'https://funder.example.org' } },
    });
  });

  it('answers a repeated request with the same key by the origin it made, once', async () => {
    const key = randomUUID();
    const first = await add(adminA, 'https://repeat.example.org', key);
    const second = await add(adminA, 'https://repeat.example.org', key);

    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await origins(adminA)).toHaveLength(1);
    await remove(adminA, first.json<{ id: string }>().id);
  });

  it.each([
    'http://plain.example.org',
    'https://funder.example.org/path',
    'https://*.example.org',
    'https://192.0.2.1',
    'https://example',
    'javascript:alert(1)',
    42,
  ])('refuses %s without writing anything', async (origin) => {
    const before = (await versions(tenantA, 'platform.embed_origins')).length;

    expect((await add(adminA, origin)).statusCode).toBe(400);

    expect(await origins(adminA)).toEqual([]);
    expect(await versions(tenantA, 'platform.embed_origins')).toHaveLength(before);
  });

  it('refuses an origin already listed, and a 21st, with a plain problem', async () => {
    for (let i = 1; i <= 19; i++) {
      expect((await add(adminA, `https://site-${i}.example.org`)).statusCode).toBe(201);
    }
    const again = await add(adminA, 'https://site-1.example.org');
    expect((await add(adminA, 'https://site-20.example.org')).statusCode).toBe(201);
    const full = await add(adminA, 'https://one-too-many.example.org');

    expect(again.statusCode).toBe(409);
    expect(again.json<{ detail: string }>().detail).toBe('That website is already on the list.');
    expect(full.statusCode).toBe(409);
    expect(full.json<{ detail: string }>().detail).toBe(
      'The list holds up to 20 websites. Remove one before you add another.',
    );
    expect(full.body).not.toContain('one-too-many');
    expect(await origins(adminA)).toHaveLength(20);
  });
});

describe('two tenants', () => {
  it('lists, shows and removes only a tenant’s own origins', async () => {
    const own = (await add(adminA, 'https://a.example.org')).json<{ id: string }>();
    const theirs = (await add(adminB, 'https://b.example.org')).json<{ id: string }>();

    expect(await origins(adminA)).toMatchObject([{ origin: 'https://a.example.org' }]);
    expect(await origins(adminB)).toMatchObject([{ origin: 'https://b.example.org' }]);
    expect((await publicRead(tenantA.slug)).json()).toEqual({ origins: ['https://a.example.org'] });
    expect((await publicRead(tenantB.slug)).json()).toEqual({ origins: ['https://b.example.org'] });

    const refused = await remove(adminA, theirs.id);

    expect(refused.statusCode).toBe(404);
    expect(await origins(adminB)).toHaveLength(1);
    expect(await versions(tenantB, 'platform.embed_origins')).toHaveLength(1);
    await remove(adminA, own.id);
    await remove(adminB, theirs.id);
  });
});

describe('the public read', () => {
  it('gives a switched-off, unknown, suspended and malformed tenant one 404', async () => {
    const off = await createTestTenant();
    const member = await addMember(off, 'console', 'tenant_admin');
    await asMigratorIn(off.id, (client) =>
      insertRow(client, 'app.embed_origin', {
        tenant_id: off.id,
        origin: 'https://off.example.org',
        created_by: member.membershipId,
      }),
    );
    const suspended = await createTestTenant();
    const owner = await addMember(suspended, 'console', 'tenant_admin');
    await asMigratorIn(suspended.id, async (client) => {
      await insertRow(client, 'app.tenant_module', {
        tenant_id: suspended.id,
        module: 'forms',
        enabled: true,
        updated_by: owner.membershipId,
      });
      await insertRow(client, 'app.embed_origin', {
        tenant_id: suspended.id,
        origin: 'https://suspended.example.org',
        created_by: owner.membershipId,
      });
      await client.query("UPDATE app.tenant SET status = 'suspended'");
    });

    const unknown = await publicRead('no-such-tenant');
    expect(unknown.statusCode).toBe(404);
    for (const slug of [off.slug, suspended.slug, 'Bad_Slug']) {
      const response = await publicRead(slug);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        ...unknown.json<object>(),
        requestId: response.json<{ requestId: string }>().requestId,
      });
      expect(response.body).not.toContain('example.org');
    }
  });
});
