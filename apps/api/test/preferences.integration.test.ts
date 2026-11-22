// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The portal preference routes through the API's route registration against
// the test database, as app_api: the session, the policy, the scope rule, row-
// level security and the audit log, for two tenants. The handlers are
// imported from their folder because the module's server entry point does not export them yet.

import { randomUUID } from 'node:crypto';

import { partyPreferenceRoutes } from '@pixel-scientists/party/contracts';
import { partyResolvers } from '@pixel-scientists/party/server';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase, type ApiDatabase } from '../src/database.ts';
import { createLogger } from '../src/logger.ts';
import { route } from '../src/routes/register.ts';
import { switchModule } from './modules-on.ts';
import { smtpTestSettings, testAuth, testSession } from './support.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../packages/db/test/tenants.ts';
import { preferenceHandlers } from '../../../modules/party/src/server/preferences/index.ts';

// Each request runs a statement on a connection shared with other lanes.
vi.setConfig({ testTimeout: 30_000 });

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

async function addMember(
  tenant: TestTenant,
  app: 'console' | 'portal',
  role: string,
  name: string,
): Promise<Member> {
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles: [role] }),
  );
  return { userId, membershipId, tenant, app, email: `${name}@example.org` };
}

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41007',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'silent' });
  database = openDatabase(settings, logger);
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  alice = await addMember(tenantA, 'portal', 'applicant', 'alice');
  bob = await addMember(tenantA, 'portal', 'applicant', 'bob');
  carol = await addMember(tenantB, 'portal', 'applicant', 'carol');
  manager = await addMember(tenantA, 'console', 'programme_manager', 'manager');

  const handlers = preferenceHandlers();
  api = await buildApp({
    logger,
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    auth: auth.module,
    resolvers: partyResolvers,
    routes: [
      route(partyPreferenceRoutes.getPreferences, handlers.getPreferences),
      route(partyPreferenceRoutes.changePreference, handlers.changePreference),
    ],
  });
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

function send(
  member: Member,
  method: 'GET' | 'PUT',
  payload?: object,
  app = member.app,
): Promise<LightMyRequestResponse> {
  const session = {
    ...testSession({ app, userId: member.userId, tenant: member.tenant.id }),
    email: () => Promise.resolve(member.email),
  };
  return api.inject({
    method,
    url: '/api/portal/profile/preferences',
    headers: auth.as({ app, session }),
    ...(payload === undefined ? {} : { payload }),
  });
}

const choice = (state: 'given' | 'withdrawn', change: Record<string, unknown> = {}) => ({
  purpose: 'future_funding',
  channel: 'email',
  state,
  privacyNoticeVersion: '2026-11',
  ...change,
});

const unset = {
  preferences: [{ purpose: 'future_funding', channel: 'email', state: null, recordedAt: null }],
};

/** Consent rows and consent audit events of a tenant that a membership wrote, read as the migrator. */
function recorded(tenant: TestTenant, membershipId: string) {
  return asMigratorIn(tenant.id, async (client) => {
    const consents = await client.query<{ id: string; state: string; source: string }>(
      'SELECT id, state, source FROM party.consent WHERE recorded_by = $1 ORDER BY recorded_at, id',
      [membershipId],
    );
    const events = await client.query<{
      entity_id: string;
      subject_party_id: string;
      changes: Record<string, unknown>;
    }>(
      `SELECT entity_id, subject_party_id, changes FROM app.audit_event
        WHERE action = 'party.consent.recorded' AND actor_id = $1 ORDER BY occurred_at, id`,
      [membershipId],
    );
    return { consents: consents.rows, events: events.rows };
  });
}

describe('reading preferences', () => {
  it('shows every purpose and channel as not chosen, and makes no person', async () => {
    const response = await send(alice, 'GET');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(unset);
    const people = await asMigratorIn(tenantA.id, (client) =>
      client.query('SELECT 1 FROM party.person WHERE user_id = $1', [alice.userId]),
    );
    expect(people.rowCount).toBe(0);
  });

  it('takes no person or user from the request', async () => {
    const response = await api.inject({
      method: 'GET',
      url: `/api/portal/profile/preferences?personId=${randomUUID()}&userId=${bob.userId}`,
      headers: auth.as({
        app: 'portal',
        session: testSession({ app: 'portal', userId: alice.userId, tenant: tenantA.id }),
      }),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('changing a preference', () => {
  it('records one portal row and one audit event with the person, and a repeat records nothing', async () => {
    const first = await send(alice, 'PUT', choice('given'));

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      preferences: [{ purpose: 'future_funding', channel: 'email', state: 'given' }],
    });
    const again = await send(alice, 'PUT', choice('given'));
    expect(again.json()).toEqual(first.json());

    const { consents, events } = await recorded(tenantA, alice.membershipId);
    expect(consents).toMatchObject([{ state: 'given', source: 'portal' }]);
    expect(events).toHaveLength(1);
    expect(events[0]?.entity_id).toBe(consents[0]?.id);
    expect(Object.keys(events[0]?.changes ?? {}).sort()).toEqual([
      'party.consent.channel',
      'party.consent.privacy_notice_version',
      'party.consent.purpose',
      'party.consent.state',
    ]);
    const person = await asMigratorIn(tenantA.id, (client) =>
      client.query<{ id: string }>('SELECT id FROM party.person WHERE user_id = $1', [
        alice.userId,
      ]),
    );
    expect(events[0]?.subject_party_id).toBe(person.rows[0]?.id);
    const read = await send(alice, 'GET');
    expect(read.json()).toEqual(first.json());
  });

  it('withdraws, and grants again after an unsubscribe with a new row that leaves the suppression', async () => {
    expect((await send(bob, 'PUT', choice('given'))).statusCode).toBe(200);
    const personId = (
      await asMigratorIn(tenantA.id, (client) =>
        client.query<{ id: string }>('SELECT id FROM party.person WHERE user_id = $1', [
          bob.userId,
        ]),
      )
    ).rows[0]?.id;
    // What the public unsubscribe leaves: a withdrawal and a suppression after it.
    await asMigratorIn(tenantA.id, async (client) => {
      await insertRow(client, 'party.consent', {
        tenant_id: tenantA.id,
        person_id: personId,
        purpose: 'future_funding',
        channel: 'email',
        state: 'withdrawn',
        privacy_notice_version: '2026-11',
        source: 'unsubscribe',
      });
      await insertRow(client, 'party.suppression', {
        tenant_id: tenantA.id,
        person_id: personId,
        channel: 'email',
        purpose: 'future_funding',
        reason: 'unsubscribed',
        source: 'unsubscribe',
        address_hash: Buffer.alloc(32, 1),
        hash_key_version: 1,
      });
    });
    expect((await send(bob, 'GET')).json()).toMatchObject({
      preferences: [{ state: 'withdrawn' }],
    });
    // Withdrawing again changes nothing: the person is already not contacted.
    await send(bob, 'PUT', choice('withdrawn'));
    expect((await recorded(tenantA, bob.membershipId)).consents).toHaveLength(1);

    const granted = await send(bob, 'PUT', choice('given'));

    expect(granted.json()).toMatchObject({ preferences: [{ state: 'given' }] });
    expect((await recorded(tenantA, bob.membershipId)).consents).toMatchObject([
      { state: 'given', source: 'portal' },
      { state: 'given', source: 'portal' },
    ]);
    const suppressions = await asMigratorIn(tenantA.id, (client) =>
      client.query('SELECT 1 FROM party.suppression WHERE person_id = $1', [personId]),
    );
    expect(suppressions.rowCount).toBe(1);
  });

  it.each([
    ['an unknown purpose', { purpose: 'marketing' }],
    ['a channel the portal does not offer', { channel: 'sms' }],
    ['a person', { personId: randomUUID() }],
    ['a user', { userId: randomUUID() }],
    ['who recorded it', { recordedBy: randomUUID() }],
    ['a tenant', { tenantId: randomUUID() }],
    ['a bad notice version', { privacyNoticeVersion: '../etc' }],
  ])('refuses %s and records nothing', async (_name, change) => {
    const before = await recorded(tenantA, alice.membershipId);

    const response = await send(alice, 'PUT', choice('withdrawn', change));

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('etc');
    expect(await recorded(tenantA, alice.membershipId)).toEqual(before);
  });
});

describe('who may use the routes', () => {
  it('refuses a console session on both routes', async () => {
    const read = await send(manager, 'GET');
    const change = await send(manager, 'PUT', choice('given'));

    expect([read.statusCode, change.statusCode]).toEqual([403, 403]);
    expect((await recorded(tenantA, manager.membershipId)).consents).toEqual([]);
  });

  it('refuses a request with no session', async () => {
    const response = await api.inject({ method: 'GET', url: '/api/portal/profile/preferences' });

    expect(response.statusCode).toBe(401);
  });

  it('keeps each person’s choices, and each tenant’s, to themselves', async () => {
    await send(carol, 'PUT', choice('given'));
    const { consents } = await recorded(tenantB, carol.membershipId);
    expect(consents).toHaveLength(1);

    const bobCarol = await recorded(tenantA, carol.membershipId);
    expect(bobCarol.consents).toEqual([]);
    const other = await addMember(tenantA, 'portal', 'applicant', 'dan');
    expect((await send(other, 'GET')).json()).toEqual(unset);
    // The same account in another tenant is another person: nothing carried over.
    const inB = { ...alice, tenant: tenantB };
    expect((await send(inB, 'GET')).statusCode).not.toBe(200);
  });

  it('keeps working when grants is switched off', async () => {
    await switchModule(tenantA, 'grants', false);
    const eve = await addMember(tenantA, 'portal', 'applicant', 'eve');

    const response = await send(eve, 'PUT', choice('given'));

    expect(response.statusCode).toBe(200);
    await switchModule(tenantA, 'grants', true);
  });
});
