// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The audit log route through the whole API against the test database, as
// app_api: sessions, the policy, row-level security and the handler, for
// several tenants.

import { randomUUID } from 'node:crypto';

import { insertAuditEvent, type AuditEventRow } from '@pixel-scientists/db';
import type { AuditEventPage } from '@pixel-scientists/domain/platform/audit-log';
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
import { smtpTestSettings, tenantId, testAuth, testSession } from '../../../test/support.ts';
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
  readonly app: 'console' | 'portal';
}

let api: FastifyInstance;
let database: ApiDatabase;
const auth = testAuth();

let tenantA: TestTenant;
let tenantB: TestTenant;
let adminA: Member;
let adminNoPerson: Member;
let managerA: Member;
let reviewerA: Member;
let applicantA: Member;
let adminB: Member;
const entity = randomUUID();
const otherEntity = randomUUID();
const authEventId = randomUUID();
const entityB = randomUUID();

async function addMember(
  tenant: TestTenant,
  app: 'console' | 'portal',
  role: string,
  name?: { given: string; family: string },
): Promise<Member> {
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(tenant.id, async (client) => {
    const id = await insertRow(client, 'app.membership', {
      tenant_id: tenant.id,
      user_id: userId,
      roles: [role],
    });
    if (name !== undefined) {
      await addPerson(client, tenant, {
        user_id: userId,
        given_name: name.given,
        family_name: name.family,
      });
    }
    return id;
  });
  return { userId, membershipId, tenant, app };
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

/** One event in its own transaction, so each has its own time. */
const record = (tenant: TestTenant, row: Partial<AuditEventRow>): Promise<void> =>
  database.inTenant(tenantId(tenant.id), (tx) => insertAuditEvent(tx, eventRow(row)));

/** Many events in one transaction, so they share a time and the id breaks the tie. */
const recordMany = (tenant: TestTenant, entityIds: readonly string[]): Promise<void> =>
  database.inTenant(tenantId(tenant.id), async (tx) => {
    for (const entityId of entityIds) await insertAuditEvent(tx, eventRow({ entityId }));
  });

const by = (member: Member): Partial<AuditEventRow> => ({
  actorKind: 'user',
  actorId: member.membershipId,
});

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41002',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'silent' });
  database = openDatabase(settings, logger);

  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  adminA = await addMember(tenantA, 'console', 'tenant_admin', {
    given: 'Ada',
    family: 'Lovelace',
  });
  adminNoPerson = await addMember(tenantA, 'console', 'tenant_admin');
  managerA = await addMember(tenantA, 'console', 'programme_manager');
  reviewerA = await addMember(tenantA, 'console', 'reviewer');
  applicantA = await addMember(tenantA, 'portal', 'applicant');
  adminB = await addMember(tenantB, 'console', 'tenant_admin', { given: 'Bo', family: 'Burns' });

  // Oldest first.
  await record(tenantA, {
    ...by(adminA),
    action: 'platform.theme.changed',
    entityType: 'platform.theme',
    entityId: entity,
    changes: {
      'app.tenant_theme.brand_colour': { before: '#111111', after: '#222222' },
      f_abc: { before: 'secret', after: 'secret too' },
    },
  });
  await record(tenantA, {
    ...by(adminNoPerson),
    action: 'platform.membership.suspended',
    entityType: 'platform.membership',
    entityId: otherEntity,
  });
  await record(tenantA, {
    ...by(applicantA),
    action: 'grants.application.submitted',
    entityType: 'grants.application',
  });
  await record(tenantA, {
    action: 'platform.auth.sign_in_succeeded',
    entityType: 'platform.auth',
    entityId: authEventId,
  });
  await record(tenantA, { actorKind: 'operator' });
  await record(tenantB, {
    ...by(adminB),
    action: 'platform.theme.changed',
    entityType: 'platform.theme',
    entityId: entityB,
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

function as(member: Member): Record<string, string> {
  const session = testSession({
    app: member.app,
    userId: member.userId,
    tenant: member.tenant.id,
  });
  return auth.as({ app: member.app, session });
}

const read = (member: Member, query = '') =>
  api.inject({ method: 'GET', url: `/api/console/audit-events${query}`, headers: as(member) });

async function page(member: Member, query = ''): Promise<AuditEventPage> {
  const response = await read(member, query);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<AuditEventPage>();
}

const eventCount = (tenant: TestTenant): Promise<number> =>
  asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<{ n: string }>('SELECT count(*) AS n FROM app.audit_event');
    return Number(rows[0]?.n);
  });

describe('who may read the log', () => {
  it('lets only a holder of platform.audit.read in', async () => {
    expect((await read(adminA)).statusCode).toBe(200);
    expect((await read(adminNoPerson)).statusCode).toBe(200);
    for (const member of [managerA, reviewerA, applicantA]) {
      expect((await read(member)).statusCode, member.membershipId).toBe(403);
    }
    const signedOut = await api.inject({ method: 'GET', url: '/api/console/audit-events' });
    expect(signedOut.statusCode).toBe(401);
  });

  it('refuses a portal session for an administrator’s account', async () => {
    const session = testSession({ app: 'portal', userId: adminA.userId, tenant: tenantA.id });
    const response = await api.inject({
      method: 'GET',
      url: '/api/console/audit-events',
      headers: auth.as({ app: 'portal', session }),
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('what the log shows', () => {
  it('lists the tenant’s events newest first, with each kind of actor', async () => {
    const { events, nextCursor } = await page(adminA);

    expect(nextCursor).toBeNull();
    expect(events.map((event) => event.action)).toEqual([
      'platform.tenant.updated',
      'platform.auth.sign_in_succeeded',
      'grants.application.submitted',
      'platform.membership.suspended',
      'platform.theme.changed',
    ]);
    expect(events.map((event) => event.actor)).toEqual([
      { kind: 'operator' },
      { kind: 'system' },
      { kind: 'applicant', membershipId: applicantA.membershipId },
      { kind: 'staff', membershipId: adminNoPerson.membershipId, name: null },
      { kind: 'staff', membershipId: adminA.membershipId, name: 'Ada Lovelace' },
    ]);
  });

  it('returns changes as stored: field ids, with values only where the writer kept them', async () => {
    const { events } = await page(adminA, `?entityId=${entity}`);

    expect(events).toHaveLength(1);
    expect(events[0]?.changes).toEqual({
      'app.tenant_theme.brand_colour': { before: '#111111', after: '#222222' },
      f_abc: {},
    });
  });

  it('shows a tenant’s copy of an auth event by its code and the auth event’s id', async () => {
    const { events } = await page(adminA, '?action=platform.auth.sign_in_succeeded');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'platform.auth.sign_in_succeeded',
      entityType: 'platform.auth',
      entityId: authEventId,
    });
  });

  it('does not audit a read', async () => {
    const before = await eventCount(tenantA);
    await page(adminA);
    await page(adminA, `?entityId=${entity}`);

    expect(await eventCount(tenantA)).toBe(before);
  });
});

describe('filters', () => {
  it('filters by module, action, entity and person', async () => {
    const actions = async (query: string) =>
      (await page(adminA, query)).events.map((event) => event.action);

    expect(await actions('?module=grants')).toEqual(['grants.application.submitted']);
    expect(await actions('?module=platform')).toHaveLength(4);
    expect(await actions('?action=platform.theme.changed')).toEqual(['platform.theme.changed']);
    expect(await actions('?entityType=platform.membership')).toEqual([
      'platform.membership.suspended',
    ]);
    expect(await actions(`?entityType=platform.membership&entityId=${otherEntity}`)).toHaveLength(
      1,
    );
    expect(await actions(`?entityType=platform.theme&entityId=${otherEntity}`)).toEqual([]);
    expect(await actions(`?byMembershipId=${adminA.membershipId}`)).toEqual([
      'platform.theme.changed',
    ]);
    expect(await actions('?module=grants&action=platform.theme.changed')).toEqual([]);
  });

  it('refuses a filter the contract does not allow, and values that are not valid', async () => {
    for (const query of [
      `?tenantId=${tenantB.id}`,
      '?limit=1000',
      '?module=nothing',
      '?action=Not-An-Action',
      '?entityId=1',
      '?from=yesterday',
      '?from=2026-02-31',
      '?cursor=!',
      `?cursor=${Buffer.from('nonsense').toString('base64url')}`,
    ]) {
      const response = await read(adminA, query);
      expect(response.statusCode, query).toBe(400);
      expect(response.body, query).not.toMatch(/node_modules|\.ts:|select /i);
    }
  });

  it('counts days in the tenant’s time zone, both ends included', async () => {
    const tenant = await createTestTenant();
    const admin = await addMember(tenant, 'console', 'tenant_admin');
    await record(tenant, {});

    // One zone is ahead of UTC and one behind, so they cannot both share its date.
    for (const timezone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const [today, tomorrow, yesterday] = await asMigratorIn(tenant.id, async (client) => {
        await client.query('UPDATE app.tenant SET timezone = $1', [timezone]);
        const { rows } = await client.query<{ days: string[] }>(
          `SELECT ARRAY[(now() AT TIME ZONE timezone)::date,
                        (now() AT TIME ZONE timezone)::date + 1,
                        (now() AT TIME ZONE timezone)::date - 1]::text[] AS days
             FROM app.tenant`,
        );
        return rows[0]?.days ?? [];
      });
      const count = async (query: string) => (await page(admin, query)).events.length;

      expect(await count(`?from=${today}&to=${today}`), timezone).toBe(1);
      expect(await count(`?from=${tomorrow}`), timezone).toBe(0);
      expect(await count(`?to=${yesterday}`), timezone).toBe(0);
      expect(await count(`?from=${yesterday}&to=${tomorrow}`), timezone).toBe(1);
    }
  });
});

describe('another tenant', () => {
  it('never shows its events, with or without a filter', async () => {
    const own = await page(adminB);
    expect(own.events.map((event) => event.entityId)).toEqual([entityB]);

    const aimedAtA = [
      `?entityId=${entity}`,
      `?entityId=${otherEntity}`,
      `?entityId=${authEventId}`,
      `?byMembershipId=${adminA.membershipId}`,
      `?byMembershipId=${applicantA.membershipId}`,
      '?module=grants',
      '?action=platform.auth.sign_in_succeeded',
      '?action=platform.membership.suspended',
      '?entityType=platform.membership',
      '?module=platform&from=2000-01-01&to=2100-01-01',
    ];
    for (const query of aimedAtA) {
      const { events } = await page(adminB, query);
      expect(
        events.filter((event) => event.entityId !== entityB),
        query,
      ).toEqual([]);
    }
    expect(JSON.stringify(await page(adminB))).not.toContain('Ada');
  });

  it('does not take a cursor from another tenant’s log', async () => {
    const tenant = await createTestTenant();
    const admin = await addMember(tenant, 'console', 'tenant_admin');
    const ids = Array.from({ length: PAGE_SIZE + 1 }, () => randomUUID());
    await recordMany(tenant, ids);
    const first = await page(admin);
    expect(first.nextCursor).not.toBeNull();

    const other = await page(adminB, `?cursor=${first.nextCursor ?? ''}`);

    expect(other.events.every((event) => event.entityId === entityB)).toBe(true);
  });
});

describe('paging', () => {
  it('pages without a gap or a repeat while new events arrive', async () => {
    const tenant = await createTestTenant();
    const admin = await addMember(tenant, 'console', 'tenant_admin');
    const written = Array.from({ length: PAGE_SIZE + 5 }, () => randomUUID());
    await recordMany(tenant, written);

    const first = await page(admin);
    expect(first.events).toHaveLength(PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();

    const arrived = randomUUID();
    await record(tenant, { entityId: arrived });
    const second = await page(admin, `?cursor=${first.nextCursor ?? ''}`);

    expect(second.events).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.events, ...second.events].map((event) => event.entityId);
    expect(new Set(seen)).toEqual(new Set(written));
    expect(seen).toHaveLength(written.length);
    expect((await page(admin)).events[0]?.entityId).toBe(arrived);
  });
});
