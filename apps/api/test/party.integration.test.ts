// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party routes through the whole API against the test database, as
// app_api: sessions, the policy, the scope rules, the handlers, row-level
// security and the audit log, for two tenants.

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOrganisation, addPerson } from '../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../packages/db/test/tenants.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase, type ApiDatabase } from '../src/database.ts';
import { createLogger } from '../src/logger.ts';
import { composeModules } from '../src/modules.ts';
import { expectLooksMissing, smtpTestSettings, testAuth, testSession } from './support.ts';

interface Member {
  readonly userId: string;
  readonly membershipId: string;
  readonly tenant: TestTenant;
  readonly app: 'console' | 'portal';
  readonly email: string;
}

let api: FastifyInstance;
let database: ApiDatabase;
const auth = testAuth();

let tenantA: TestTenant;
let tenantB: TestTenant;
let alice: Member;
let bob: Member;
let carol: Member;
let manager: Member;
let managerB: Member;
let reviewer: Member;

async function addMember(
  tenant: TestTenant,
  app: 'console' | 'portal',
  role: string,
  name: string,
): Promise<Member> {
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', {
      tenant_id: tenant.id,
      user_id: userId,
      roles: [role],
    }),
  );
  return { userId, membershipId, tenant, app, email: `${name}@Example.org` };
}

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41001',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'silent' });
  database = openDatabase(settings, logger);

  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  alice = await addMember(tenantA, 'portal', 'applicant', 'alice');
  bob = await addMember(tenantA, 'portal', 'applicant', 'bob');
  carol = await addMember(tenantB, 'portal', 'applicant', 'carol');
  manager = await addMember(tenantA, 'console', 'programme_manager', 'manager');
  managerB = await addMember(tenantB, 'console', 'programme_manager', 'managerb');
  reviewer = await addMember(tenantA, 'console', 'reviewer', 'reviewer');

  api = await buildApp({
    logger,
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    auth: auth.module,
    ...composeModules(),
  });
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

function as(member: Member, app: 'console' | 'portal' = member.app): Record<string, string> {
  const session = {
    ...testSession({ app, userId: member.userId, tenant: member.tenant.id }),
    email: () => Promise.resolve(member.email),
  };
  return auth.as({ app, session });
}

const send = (
  member: Member,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) =>
  api.inject({ method, url: `/api${url}`, headers: as(member), ...(payload ? { payload } : {}) });

const organisationBody = (change: Record<string, unknown> = {}) => ({
  name: 'Northfield Allotment Society',
  legalForm: 'community_benefit_society',
  identifiers: [{ scheme: 'GB-CHC', identifier: '1234567' }],
  registeredAddress: { line1: '1 High Street', town: 'Northfield', postcode: 'nf1 2ab' },
  ...change,
});

interface AuditRow {
  action: string;
  entity_id: string;
  actor_id: string;
  actor_kind: string;
  changes: Record<string, unknown>;
}

/** The audit events of one action in a tenant, oldest first. */
function auditEvents(tenant: TestTenant, action: string): Promise<AuditRow[]> {
  return asMigratorIn(tenant.id, async (client) => {
    const { rows } = await client.query<AuditRow>(
      `SELECT action, entity_id, actor_id, actor_kind, changes FROM app.audit_event
        WHERE action = $1 ORDER BY occurred_at, id`,
      [action],
    );
    return rows;
  });
}

async function organisationBy(member: Member, change: Record<string, unknown> = {}) {
  const response = await send(member, 'POST', '/portal/organisations', organisationBody(change));
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>();
}

describe('the portal profile', () => {
  it('makes the person from the session on the first read, never from the body', async () => {
    const response = await send(alice, 'GET', '/portal/profile');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      givenName: null,
      familyName: null,
      email: 'alice@example.org',
      phone: null,
      consents: [],
    });
    const again = await send(alice, 'GET', '/portal/profile');
    expect(again.json()).toEqual(response.json());
    const created = await auditEvents(tenantA, 'party.person.created');
    expect(created.filter((event) => event.actor_id === alice.membershipId)).toHaveLength(1);
    expect(JSON.stringify(created)).not.toContain('alice@');
  });

  it('refuses a body that names a person, user, tenant or email', async () => {
    const bodies = [
      { givenName: 'Al', familyName: 'Ice', userId: bob.userId },
      { givenName: 'Al', familyName: 'Ice', personId: randomUUID() },
      { givenName: 'Al', familyName: 'Ice', email: 'mallory@example.org' },
      { givenName: 'Al', familyName: 'Ice', tenantId: tenantB.id },
    ];
    for (const body of bodies) {
      const response = await send(alice, 'PUT', '/portal/profile', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
    const profile = await send(alice, 'GET', '/portal/profile');
    expect(profile.json<{ email: string }>().email).toBe('alice@example.org');
  });

  it('changes the name and phone number, and audits field ids without values', async () => {
    const response = await send(alice, 'PUT', '/portal/profile', {
      givenName: 'Alice',
      familyName: 'Archer',
      phone: '01632 960 001',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      givenName: 'Alice',
      familyName: 'Archer',
      phone: '01632 960 001',
      email: 'alice@example.org',
    });
    const events = (await auditEvents(tenantA, 'party.person.updated')).filter(
      (event) => event.actor_id === alice.membershipId,
    );
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]?.changes ?? {}).sort()).toEqual([
      'party.person.family_name',
      'party.person.given_name',
      'party.person.phone',
    ]);
    expect(JSON.stringify(events)).not.toMatch(/Alice|Archer|960/);
    const cleared = await send(alice, 'PUT', '/portal/profile', {
      givenName: 'Alice',
      familyName: 'Archer',
    });
    expect(cleared.json<{ phone: string | null }>().phone).toBeNull();
  });

  it('gives each applicant their own person', async () => {
    const response = await send(bob, 'GET', '/portal/profile');

    expect(response.json<{ email: string; givenName: string | null }>()).toMatchObject({
      email: 'bob@example.org',
      givenName: null,
    });
  });
});

describe('consent', () => {
  const choice = (state: string) => ({
    purpose: 'future_funding',
    channel: 'email',
    state,
    privacyNoticeVersion: '2026-10',
  });

  it('appends a row for each change, shows the latest, and audits each', async () => {
    const given = await send(bob, 'POST', '/portal/profile/consents', choice('given'));
    const withdrawn = await send(bob, 'POST', '/portal/profile/consents', choice('withdrawn'));

    expect(given.statusCode).toBe(201);
    expect(given.json()).toMatchObject({ state: 'given', privacyNoticeVersion: '2026-10' });
    expect(withdrawn.json()).toMatchObject({ state: 'withdrawn' });
    const profile = await send(bob, 'GET', '/portal/profile');
    expect(profile.json<{ consents: { state: string }[] }>().consents).toMatchObject([
      { purpose: 'future_funding', channel: 'email', state: 'withdrawn' },
    ]);
    const rows = await asMigratorIn(tenantA.id, (client) =>
      client.query(`SELECT 1 FROM party.consent WHERE recorded_by = $1`, [bob.membershipId]),
    );
    expect(rows.rowCount).toBe(2);
    const events = (await auditEvents(tenantA, 'party.consent.recorded')).filter(
      (event) => event.actor_id === bob.membershipId,
    );
    expect(events).toHaveLength(2);
  });

  it('offers no way to change or delete a consent', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const response = await api.inject({
        method,
        url: '/api/portal/profile/consents',
        headers: as(bob),
        ...(method === 'DELETE' ? {} : { payload: choice('given') }),
      });
      expect(response.statusCode, method).toBe(404);
    }
    const byId = await send(bob, 'DELETE', `/portal/profile/consents/${randomUUID()}`);
    expect(byId.statusCode).toBe(404);
  });

  it('refuses a channel the portal does not offer, an unknown purpose and an extra key', async () => {
    const bad = [
      { ...choice('given'), channel: 'sms' },
      { ...choice('given'), purpose: 'marketing' },
      { ...choice('given'), personId: randomUUID() },
      { ...choice('given'), recordedBy: bob.membershipId },
    ];
    for (const body of bad) {
      const response = await send(bob, 'POST', '/portal/profile/consents', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('the portal organisations', () => {
  let aliceOrg: { id: string };

  beforeAll(async () => {
    aliceOrg = await organisationBy(alice);
  });

  it('creates an organisation with the creator as its current contact', async () => {
    const response = await send(alice, 'GET', `/portal/organisations/${aliceOrg.id}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: aliceOrg.id,
      name: 'Northfield Allotment Society',
      legalForm: 'community_benefit_society',
      identifiers: [{ scheme: 'GB-CHC', identifier: '1234567' }],
      registeredAddress: {
        line1: '1 High Street',
        line2: null,
        town: 'Northfield',
        postcode: 'NF1 2AB',
        countryCode: 'GB',
      },
      website: null,
    });
    const list = await send(alice, 'GET', '/portal/organisations');
    expect(list.json()).toEqual({
      organisations: [
        {
          id: aliceOrg.id,
          name: 'Northfield Allotment Society',
          legalForm: 'community_benefit_society',
        },
      ],
    });
    const created = (await auditEvents(tenantA, 'party.organisation.created')).filter(
      (event) => event.entity_id === aliceOrg.id,
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.actor_id).toBe(alice.membershipId);
    expect(JSON.stringify(created)).not.toMatch(/Northfield|1234567|High Street/);
    const linked = (await auditEvents(tenantA, 'party.relationship.created')).filter(
      (event) => event.actor_id === alice.membershipId,
    );
    expect(linked).toHaveLength(1);
  });

  it('shows another applicant in the same tenant nothing of it, as if it were missing', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      const outside = await send(
        bob,
        method,
        `/portal/organisations/${aliceOrg.id}`,
        method === 'PUT' ? organisationBody({ name: 'Taken over' }) : undefined,
      );
      const missing = await send(
        bob,
        method,
        `/portal/organisations/${randomUUID()}`,
        method === 'PUT' ? organisationBody({ name: 'Taken over' }) : undefined,
      );
      expectLooksMissing(outside, missing);
    }
    expect((await send(alice, 'GET', `/portal/organisations/${aliceOrg.id}`)).json()).toMatchObject(
      { name: 'Northfield Allotment Society' },
    );
  });

  it('makes a separate record when another applicant types the same charity number', async () => {
    const bobOrg = await organisationBy(bob, { name: 'Bob and friends' });
    const bobsView = await send(bob, 'GET', `/portal/organisations/${bobOrg.id}`);

    expect(bobOrg.id).not.toBe(aliceOrg.id);
    expect(bobsView.json()).toMatchObject({
      name: 'Bob and friends',
      identifiers: [{ scheme: 'GB-CHC', identifier: '1234567' }],
    });
    const mine = await send(bob, 'GET', '/portal/organisations');
    expect(mine.json<{ organisations: { id: string }[] }>().organisations).toMatchObject([
      { id: bobOrg.id, name: 'Bob and friends' },
    ]);
    const staff = await send(manager, 'GET', `/console/organisations/${bobOrg.id}`);
    expect(staff.json<{ contacts: { email: string }[]; identifiers: unknown[] }>()).toMatchObject({
      contacts: [{ email: 'bob@example.org' }],
      identifiers: [{ scheme: 'GB-CHC', identifier: '1234567', verified: false }],
    });
  });

  it('answers a malformed or unknown organisation id as missing, and a bad body with problems', async () => {
    expect((await send(alice, 'GET', '/portal/organisations/not-an-id')).statusCode).toBe(400);
    const empty = await send(alice, 'POST', '/portal/organisations', {});
    expect(empty.statusCode).toBe(400);
    const withTenant = await send(
      alice,
      'POST',
      '/portal/organisations',
      organisationBody({ tenantId: tenantB.id }),
    );
    expect(withTenant.statusCode).toBe(400);
  });

  it('changes an organisation, keeps an identifier type left out, and audits it', async () => {
    const response = await send(
      alice,
      'PUT',
      `/portal/organisations/${aliceOrg.id}`,
      organisationBody({
        name: 'Northfield Growers',
        website: 'https://growers.example.org/',
        identifiers: [{ scheme: 'GB-CHC', identifier: '1765432' }],
        registeredAddress: {
          line1: '2 Low Road',
          line2: 'Unit 4',
          town: 'Northfield',
          postcode: 'NF1 2AB',
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'Northfield Growers',
      website: 'https://growers.example.org/',
      identifiers: [{ scheme: 'GB-CHC', identifier: '1765432' }],
      registeredAddress: { line1: '2 Low Road', line2: 'Unit 4' },
    });
    const events = (await auditEvents(tenantA, 'party.organisation.updated')).filter(
      (event) => event.entity_id === aliceOrg.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.actor_id).toBe(alice.membershipId);
    expect(JSON.stringify(events)).not.toMatch(/Growers|1765432|Low Road/);

    const added = await send(
      alice,
      'PUT',
      `/portal/organisations/${aliceOrg.id}`,
      organisationBody({
        name: 'Northfield Growers',
        identifiers: [{ scheme: 'GB-COH', identifier: '01234567' }],
      }),
    );
    expect(added.json<{ identifiers: unknown[] }>().identifiers).toEqual([
      { scheme: 'GB-CHC', identifier: '1765432' },
      { scheme: 'GB-COH', identifier: '01234567' },
    ]);
  });

  it('shows no one else an organisation in another tenant', async () => {
    const outside = await send(carol, 'GET', `/portal/organisations/${aliceOrg.id}`);
    const missing = await send(carol, 'GET', `/portal/organisations/${randomUUID()}`);

    expectLooksMissing(outside, missing);
    expect((await send(carol, 'GET', '/portal/organisations')).json()).toEqual({
      organisations: [],
    });
  });
});

describe('the console', () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await asMigratorIn(tenantA.id, async (client) => {
      for (let n = 0; n < 26; n += 1) {
        const name = `Page test ${String(n).padStart(2, '0')}`;
        ids[name] = await addOrganisation(client, tenantA, { name });
      }
      ids['Wild_card%'] = await addOrganisation(client, tenantA, { name: 'Wild_card% Trust' });
      ids['Scottish'] = await addOrganisation(client, tenantA, { name: 'Highland Hearth' });
      await insertRow(client, 'party.organisation_identifier', {
        tenant_id: tenantA.id,
        organisation_id: ids['Scottish'],
        scheme: 'GB-SC',
        identifier: 'SC012345',
      });
    });
    await asMigratorIn(tenantB.id, (client) =>
      addOrganisation(client, tenantB, { name: 'Page test other tenant' }),
    );
  });

  const list = (query = '', who: Member = manager) =>
    send(who, 'GET', `/console/organisations${query}`);

  it('lists organisations by name a page at a time, and only in the tenant', async () => {
    const first = await list('?search=Page%20test');
    const page = first.json<{ organisations: { name: string }[]; nextCursor: string | null }>();

    expect(first.statusCode).toBe(200);
    expect(page.organisations).toHaveLength(25);
    expect(page.organisations[0]?.name).toBe('Page test 00');
    expect(page.nextCursor).not.toBeNull();

    const second = await list(`?search=Page%20test&cursor=${page.nextCursor}`);
    const rest = second.json<{ organisations: { name: string }[]; nextCursor: string | null }>();
    expect(rest.organisations.map((item) => item.name)).toEqual(['Page test 25']);
    expect(rest.nextCursor).toBeNull();
  });

  it('searches by identifier, with or without its scheme, and treats % and _ as text', async () => {
    for (const search of ['SC012345', 'sc%20012345', 'GB-SC-SC012345']) {
      const found = await list(`?search=${search}`);
      expect(
        found.json<{ organisations: { name: string }[] }>().organisations.map((item) => item.name),
        search,
      ).toEqual(['Highland Hearth']);
    }
    const wild = await list('?search=d_c');
    expect(
      wild.json<{ organisations: { name: string }[] }>().organisations.map((item) => item.name),
    ).toEqual(['Wild_card% Trust']);
    expect(
      (await list('?search=%25')).json<{ organisations: unknown[] }>().organisations,
    ).toHaveLength(1);
  });

  it('refuses a cursor that names no organisation here, including another tenant', async () => {
    const otherTenantOrg = await asMigratorIn(tenantB.id, (client) =>
      addOrganisation(client, tenantB, { name: 'Cursor source' }),
    );
    const cursor = Buffer.from(otherTenantOrg.replaceAll('-', ''), 'hex').toString('base64url');

    expect((await list(`?cursor=${cursor}`)).statusCode).toBe(404);
    expect((await list('?cursor=!!')).statusCode).toBe(400);
    expect((await list('?cursor=AAAA')).statusCode).toBe(404);
    expect((await list('?unknown=1')).statusCode).toBe(400);
  });

  it('reads an organisation with its contacts and verification, and audits the read', async () => {
    const org = await organisationBy(alice, { name: 'Verified Ltd', identifiers: [] });
    const identifierUser = await createTestUser();
    await asMigratorIn(tenantA.id, async (client) => {
      await insertRow(client, 'party.organisation_identifier', {
        tenant_id: tenantA.id,
        organisation_id: org.id,
        scheme: 'GB-COH',
        identifier: '09876543',
      });
      const verifier = await insertRow(client, 'app.membership', {
        tenant_id: tenantA.id,
        user_id: identifierUser,
        roles: ['tenant_admin'],
      });
      await insertRow(client, 'party.organisation_identifier', {
        tenant_id: tenantA.id,
        organisation_id: org.id,
        scheme: 'GB-CHC',
        identifier: '1111111',
      });
      await client.query(
        `UPDATE party.organisation_identifier SET verified_at = now(), verified_by = $1
          WHERE organisation_id = $2 AND scheme = 'GB-CHC'`,
        [verifier, org.id],
      );
    });

    const response = await send(manager, 'GET', `/console/organisations/${org.id}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: org.id,
      name: 'Verified Ltd',
      identifiers: [
        { scheme: 'GB-CHC', identifier: '1111111', verified: true },
        { scheme: 'GB-COH', identifier: '09876543', verified: false },
      ],
      registeredAddress: { line1: '1 High Street', postcode: 'NF1 2AB' },
      contacts: [{ email: 'alice@example.org', givenName: 'Alice', familyName: 'Archer' }],
    });
    const viewed = (await auditEvents(tenantA, 'party.organisation.viewed')).filter(
      (event) => event.entity_id === org.id,
    );
    expect(viewed).toHaveLength(1);
    expect(viewed[0]?.actor_id).toBe(manager.membershipId);
  });

  it('reads a person with their organisations and contact choices, and audits the read', async () => {
    const personId = await asMigratorIn(tenantA.id, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM party.person WHERE user_id = $1`,
        [bob.userId],
      );
      return rows[0]?.id ?? '';
    });

    const response = await send(manager, 'GET', `/console/people/${personId}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: personId,
      email: 'bob@example.org',
      organisations: [{ name: 'Bob and friends' }],
      consents: [{ purpose: 'future_funding', channel: 'email', state: 'withdrawn' }],
    });
    const viewed = (await auditEvents(tenantA, 'party.person.viewed')).filter(
      (event) => event.entity_id === personId,
    );
    expect(viewed).toHaveLength(1);
    expect(viewed[0]?.actor_id).toBe(manager.membershipId);
    expect(viewed[0]?.changes).toEqual({});
  });

  it('writes no audit event for a list, which shows no sensitive detail', async () => {
    const before = await auditEvents(tenantA, 'party.organisation.viewed');
    await list('?search=Page');
    expect(await auditEvents(tenantA, 'party.organisation.viewed')).toHaveLength(before.length);
  });

  it('answers another tenant or an unknown id as missing', async () => {
    const [inA, personInA] = await asMigratorIn(tenantA.id, async (client) => [
      await addOrganisation(client, tenantA, { name: 'Only in A' }),
      await addPerson(client, tenantA),
    ]);
    const missing = randomUUID();

    expectLooksMissing(
      await send(managerB, 'GET', `/console/organisations/${inA}`),
      await send(managerB, 'GET', `/console/organisations/${missing}`),
    );
    expectLooksMissing(
      await send(managerB, 'GET', `/console/people/${personInA}`),
      await send(managerB, 'GET', `/console/people/${missing}`),
    );
    expect((await list('?search=Only%20in%20A', managerB)).json()).toEqual({
      organisations: [],
      nextCursor: null,
    });
  });
});

describe('who may use the routes', () => {
  const consoleRoutes: [string, string][] = [
    ['GET', '/console/organisations'],
    ['GET', `/console/organisations/${randomUUID()}`],
    ['GET', `/console/people/${randomUUID()}`],
  ];
  const portalRoutes: [string, string][] = [
    ['GET', '/portal/profile'],
    ['GET', '/portal/organisations'],
    ['GET', `/portal/organisations/${randomUUID()}`],
  ];

  it('refuses a staff member without party.records.read', async () => {
    for (const [method, url] of consoleRoutes) {
      const response = await send(reviewer, method as 'GET', url);
      expect(response.statusCode, url).toBe(403);
    }
  });

  it('refuses a portal session on the console routes, and a console session on the portal ones', async () => {
    for (const [method, url] of consoleRoutes) {
      const response = await send(alice, method as 'GET', url);
      expect(response.statusCode, url).toBe(403);
    }
    for (const [method, url] of portalRoutes) {
      const response = await send(manager, method as 'GET', url);
      expect(response.statusCode, url).toBe(403);
    }
  });

  it('answers a request with no session with 401', async () => {
    const response = await api.inject({ url: '/api/portal/profile' });
    expect(response.statusCode).toBe(401);
  });

  it('keeps working when grants is switched off for the tenant', async () => {
    const switchTo = (enabled: boolean) =>
      asMigratorIn(tenantA.id, (client) =>
        client
          .query(
            `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by)
             VALUES ($1, 'grants', $2, $3)
             ON CONFLICT (tenant_id, module) DO UPDATE SET enabled = EXCLUDED.enabled`,
            [tenantA.id, enabled, manager.membershipId],
          )
          .then(() => undefined),
      );

    await switchTo(false);
    try {
      expect((await send(alice, 'GET', '/portal/profile')).statusCode).toBe(200);
      expect((await send(alice, 'GET', '/portal/organisations')).statusCode).toBe(200);
      expect((await send(manager, 'GET', '/console/organisations')).statusCode).toBe(200);
    } finally {
      await switchTo(true);
    }
  });
});

/** An unexpected failure never reaches the caller as detail. */
describe('errors', () => {
  it('sends no stack trace or database detail for a body that breaks a rule', async () => {
    const response: LightMyRequestResponse = await send(alice, 'POST', '/portal/organisations', {
      ...organisationBody(),
      name: 'x'.repeat(201),
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toMatch(/at .*\.ts|constraint|party\./);
  });
});
