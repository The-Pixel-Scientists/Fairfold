// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The consent composition through the whole API, built as main.ts builds it,
// against the test database as app_api: the one-click unsubscribe as a mail
// client posts it, and the portal preference routes, for two tenants.

import { randomBytes, randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { smtpTestSettings, testAuth, testSession } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { loadConfig, Secret } from '../config.ts';
import { openDatabase, type ApiDatabase } from '../database.ts';
import {
  signUnsubscribeToken,
  unsubscribeKeys,
  type UnsubscribeKeys,
} from '../email/unsubscribe-token.ts';
import { createLogger } from '../logger.ts';
import { composeModules } from '../modules.ts';

// Each request runs a statement on a connection shared with other lanes.
vi.setConfig({ testTimeout: 30_000 });

const SECRET = 'a-test-secret-that-is-at-least-32-bytes';
const keys = unsubscribeKeys(new Map([[1, SECRET]]), 1);
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const PREFERENCES = '/api/portal/profile/preferences';

let api: FastifyInstance;
let database: ApiDatabase;
const auth = testAuth();
let tenantA: TestTenant;
let tenantB: TestTenant;
let memberA: string;

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    ...smtpTestSettings,
    TPS_API_PORT: '41392',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'silent' });
  database = openDatabase(settings, logger);
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  memberA = await asMigratorIn(tenantA.id, (client) => addMember(client, tenantA));
  const secrets = { current: 1, versions: new Map([[1, new Secret(SECRET)]]) };
  api = await buildApp({
    logger,
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    auth: auth.module,
    ...composeModules({
      publicTenants: database.publicTenants,
      database,
      settings: {
        crm: undefined,
        marketing: { suppression: secrets, unsubscribe: secrets },
        forms: undefined,
        assure: { registryKeys: {}, sanctionsListUrl: undefined },
      },
    }),
  });
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

/** A person in the tenant who consents by email. */
const addConsenting = (tenant: TestTenant, memberId: string): Promise<string> =>
  asMigratorIn(tenant.id, async (client) => {
    const person = await addPerson(client, tenant);
    await insertRow(client, 'party.consent', {
      tenant_id: tenant.id,
      person_id: person,
      purpose: 'future_funding',
      channel: 'email',
      state: 'given',
      privacy_notice_version: '2026-11',
      source: 'portal',
      recorded_by: memberId,
    });
    return person;
  });

const tokenFor = (
  tenant: TestTenant,
  personId: string,
  options: { keys?: UnsubscribeKeys; issuedAt?: Date } = {},
) =>
  signUnsubscribeToken(
    options.keys ?? keys,
    {
      tenantId: tenant.id,
      personId,
      purpose: 'future_funding',
      channel: 'email',
      address: { hash: randomBytes(32), keyVersion: 1 },
    },
    options.issuedAt,
  );

const post = (token: string) =>
  api.inject({
    method: 'POST',
    url: `/api/public/unsubscribe?token=${token}`,
    headers: FORM,
    payload: 'List-Unsubscribe=One-Click',
  });

/** What is stored about a person, read as the migrator. */
const stored = (tenant: TestTenant, person: string) =>
  asMigratorIn(tenant.id, async (client) => {
    const count = async (table: string) =>
      Number(
        (
          await client.query<{ n: string }>(
            `SELECT count(*) AS n FROM ${table} WHERE person_id = $1`,
            [person],
          )
        ).rows[0]?.n,
      );
    return { consent: await count('party.consent'), suppression: await count('party.suppression') };
  });

/** One byte inside the ciphertext changed: a last character's padding bits would not change the bytes. */
const tamper = (token: string) => {
  const bytes = Buffer.from(token, 'base64url');
  bytes[20] = (bytes[20] ?? 0) ^ 1;
  return bytes.toString('base64url');
};

describe('the unsubscribe link', () => {
  it('unsubscribes once with a valid token, and answers already unsubscribed after', async () => {
    const person = await addConsenting(tenantA, memberA);
    const token = tokenFor(tenantA, person);

    const first = await post(token);
    const again = await post(token);

    expect([first.statusCode, first.json()]).toEqual([200, { outcome: 'unsubscribed' }]);
    expect([again.statusCode, again.json()]).toEqual([200, { outcome: 'already_unsubscribed' }]);
    expect(await stored(tenantA, person)).toEqual({ consent: 2, suppression: 1 });
  });

  it('shows what the link stops on GET and changes nothing', async () => {
    const person = await addConsenting(tenantA, memberA);
    const before = await stored(tenantA, person);

    const response = await api.inject({
      url: `/api/public/unsubscribe?token=${tokenFor(tenantA, person)}`,
    });

    expect([response.statusCode, response.json()]).toEqual([
      200,
      { purpose: 'future_funding', channel: 'email' },
    ]);
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(await stored(tenantA, person)).toEqual(before);
  });

  it('changes nothing for a tampered, expired or foreign token', async () => {
    const person = await addConsenting(tenantA, memberA);
    const before = await stored(tenantA, person);
    const tokens = [
      tamper(tokenFor(tenantA, person)),
      tokenFor(tenantA, person, { issuedAt: new Date('2020-01-01T00:00:00Z') }),
      tokenFor(tenantA, person, { keys: unsubscribeKeys(new Map([[1, `other-${SECRET}`]]), 1) }),
    ];

    for (const token of tokens) expect((await post(token)).statusCode).toBe(404);

    expect(await stored(tenantA, person)).toEqual(before);
  });

  it('records nothing in another tenant, whichever tenant the token names', async () => {
    const memberB = await asMigratorIn(tenantB.id, (client) => addMember(client, tenantB));
    const mine = await addConsenting(tenantA, memberA);
    const theirs = await addConsenting(tenantB, memberB);
    const before = [await stored(tenantA, mine), await stored(tenantB, theirs)];

    const crossed = await Promise.all([
      post(tokenFor(tenantB, mine)),
      post(tokenFor(tenantA, theirs)),
    ]);

    expect(crossed.map((response) => response.statusCode)).toEqual([404, 404]);
    expect([await stored(tenantA, mine), await stored(tenantB, theirs)]).toEqual(before);
  });
});

describe('the portal preference routes', () => {
  async function member(tenant: TestTenant, app: 'console' | 'portal', role: string) {
    const userId = await createTestUser();
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles: [role] }),
    );
    return { userId, tenant, app, email: `${randomUUID()}@example.org` };
  }
  type Member = Awaited<ReturnType<typeof member>>;

  const send = (who: Member, method: 'GET' | 'PUT', payload?: object) =>
    api.inject({
      method,
      url: PREFERENCES,
      headers: auth.as({
        app: who.app,
        session: {
          ...testSession({ app: who.app, userId: who.userId, tenant: who.tenant.id }),
          email: () => Promise.resolve(who.email),
        },
      }),
      ...(payload === undefined ? {} : { payload }),
    });

  const choice = (state: 'given' | 'withdrawn', change: object = {}) => ({
    purpose: 'future_funding',
    channel: 'email',
    state,
    privacyNoticeVersion: '2026-11',
    ...change,
  });

  const stateOf = async (who: Member) =>
    (await send(who, 'GET')).json<{ preferences: { state: string | null }[] }>().preferences[0]
      ?.state;

  it("changes only the caller's own record, from the session and not the request", async () => {
    const alice = await member(tenantA, 'portal', 'applicant');
    const bob = await member(tenantA, 'portal', 'applicant');
    const carol = await member(tenantB, 'portal', 'applicant');

    expect((await send(alice, 'PUT', choice('given'))).statusCode).toBe(200);
    const aimed = await send(alice, 'PUT', choice('withdrawn', { personId: randomUUID() }));

    expect(aimed.statusCode).toBe(400);
    expect(await stateOf(alice)).toBe('given');
    expect(await stateOf(bob)).toBeNull();
    expect(await stateOf(carol)).toBeNull();
  });

  it('refuses a console session, and a request with no session', async () => {
    const staff = await member(tenantA, 'console', 'programme_manager');

    const read = await send(staff, 'GET');
    const change = await send(staff, 'PUT', choice('given'));

    expect([read.statusCode, change.statusCode]).toEqual([403, 403]);
    expect((await api.inject({ url: PREFERENCES })).statusCode).toBe(401);
  });
});
