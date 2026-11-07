// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Listing and removing passkeys against the test database (ADR 0010):
// step-up on a clock, the session's user only (ADR 0007's "deleting another
// user's passkey"), the last-factor rule, passkeys as a factor at sign-in in
// both apps, and everything revoked, recorded, copied and emailed, with no
// credential id or public key anywhere it should not be. The rows are added
// directly, as registration is not built yet.

import { randomBytes, randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectionSettings, withClient } from '../../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  testSlug,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { captureLogs } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { Secret } from '../../config.ts';
import type { Email, SendResult, Sender } from '../../email/sender.ts';
import { createLogger } from '../../logger.ts';
import { newToken } from '../cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from '../index.ts';
import { hashPassword } from '../passwords.ts';

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const HOSTS = { console: 'console.example.org', portal: 'apply.example.org' } as const;
type AppName = keyof typeof HOSTS;
/** Each app's session cookie in a Set-Cookie header. */
const SESSION_COOKIE: Record<AppName, RegExp> = {
  console: /__Host-tps_console_session=([^;]*);/,
  portal: /__Host-tps_portal_session=([^;]*);/,
};
const PASSWORD = 'a long synthetic passphrase';
const PUBLIC_KEY = randomBytes(77).toString('base64');

let app: FastifyInstance;
let auth: Auth;
let tenantA: TestTenant;
let tenantB: TestTenant;
const logs = captureLogs();
const sent: Email[] = [];
let sendResult: SendResult = { sent: true };
const sender: Sender = {
  send(email) {
    sent.push(email);
    return Promise.resolve(sendResult);
  },
};
const bodies: string[] = [];
const credentials: string[] = [];

interface User {
  readonly email: string;
  readonly userId: string;
  readonly ip: string;
}

function call(
  method: 'POST' | 'DELETE' | 'GET',
  path: string,
  token: string | undefined,
  payload?: object,
  target: AppName = 'console',
  ip = '192.0.2.1',
) {
  return app
    .inject({
      method,
      url: `/api${path}`,
      remoteAddress: ip,
      headers: {
        host: HOSTS[target],
        origin: ORIGINS[target],
        ...(token === undefined ? {} : { cookie: `__Host-tps_${target}_session=${token}` }),
      },
      ...(payload === undefined ? {} : { payload }),
    })
    .then((response) => {
      bodies.push(response.body);
      return response;
    });
}

const list = (token: string, target: AppName = 'console') =>
  call('GET', '/auth/passkeys', token, undefined, target);
const remove = (token: string, id: string, target: AppName = 'console') =>
  call('DELETE', `/auth/passkeys/${id}`, token, undefined, target);
const session = (token: string, target: AppName = 'console') =>
  call('GET', '/auth/session', token, undefined, target);

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

/** A new account with a password and a membership with `roles` in each tenant given. */
async function addUser(tenants: TestTenant[], roles = ['tenant_admin']): Promise<User> {
  const email = `${testSlug()}@example.test`;
  const hash = await hashPassword(PASSWORD);
  const userId = await withClient('app_auth', async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO auth."user" (email, email_verified) VALUES ($1, true) RETURNING id',
      [email],
    );
    const id = rows[0]?.id ?? '';
    await client.query(
      `INSERT INTO auth.account (user_id, account_id, provider_id, password)
       VALUES ($1::uuid, $1::text, 'credential', $2)`,
      [id, hash],
    );
    return id;
  });
  for (const tenant of tenants) {
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles }),
    );
  }
  return { email, userId, ip: `10.${[...randomBytes(3)].join('.')}` };
}

/** Give the user a passkey named `name`, as registration stores one, and return its id. */
async function addPasskey(userId: string, name = 'Work laptop'): Promise<string> {
  const credential = randomBytes(32).toString('base64url');
  credentials.push(credential);
  const [row] = await migrator<{ id: string }>(
    `INSERT INTO auth.passkey (user_id, credential_id, public_key, counter, name, device_type,
                               backed_up, transports)
     VALUES ($1, $2, $3, 0, $4, 'multiDevice', true, 'internal') RETURNING id`,
    [userId, credential, PUBLIC_KEY, name],
  );
  return row?.id ?? '';
}

/** Give the user a confirmed authenticator app that no test reads codes from. */
const addTotp = (userId: string) =>
  migrator('INSERT INTO auth.two_factor (user_id, secret, verified) VALUES ($1, $2, true)', [
    userId,
    'ab'.repeat(60),
  ]);

/** Sign in with the password: the session's token and the MFA state it waits in. */
async function signIn(tenant: TestTenant, user: User, target: AppName = 'console') {
  const response = await call(
    'POST',
    `/auth/tenants/${tenant.slug}/sign-in`,
    undefined,
    { email: user.email, password: PASSWORD },
    target,
    user.ip,
  );
  expect(response.statusCode).toBe(200);
  const token = SESSION_COOKIE[target].exec(String(response.headers['set-cookie']))?.[1] ?? '';
  return { token, mfa: response.json<{ mfa: string }>().mfa };
}

/**
 * A complete session that has just re-authenticated, as one that proved a
 * passkey would be; passkey sign-in is not built yet.
 */
async function signedIn(tenant: TestTenant, user: User, target: AppName = 'console') {
  const { token } = await signIn(tenant, user, target);
  await migrator(
    `UPDATE auth.session SET mfa_state = 'complete', reauthenticated_at = now()
      WHERE user_id = $1 AND app = $2 AND revoked_at IS NULL`,
    [user.userId, target],
  );
  return token;
}

const passkeyIds = (userId: string) =>
  migrator<{ id: string }>('SELECT id FROM auth.passkey WHERE user_id = $1 ORDER BY id', [
    userId,
  ]).then((rows) => rows.map((row) => row.id));

const events = (userId: string) =>
  migrator<{ code: string; reason: string | null; tenant_id: string | null }>(
    `SELECT code, reason, tenant_id FROM auth.audit_event WHERE user_id = $1
      AND code IN ('passkey_removed', 'sessions_revoked') ORDER BY occurred_at, code`,
    [userId],
  );

/** The tenant's copies of the user's auth events. */
const copies = (tenant: TestTenant, userId: string) =>
  asMigratorIn(tenant.id, async (client) =>
    (
      await client.query<{ action: string }>(
        `SELECT action FROM app.audit_event
          WHERE entity_id IN (SELECT id FROM auth.audit_event WHERE user_id = $1)`,
        [userId],
      )
    ).rows.map((row) => row.action),
  );

beforeAll(async () => {
  const api = connectionSettings('app_api');
  const settings = loadAuthSettings({
    TPS_DEV: '1',
    TPS_DB_HOST: api.host,
    TPS_AUTH_SECRET: newToken(),
    TPS_DB_APP_AUTH_PASSWORD: connectionSettings('app_auth').password,
    TPS_CONSOLE_ORIGIN: ORIGINS.console,
    TPS_PORTAL_ORIGIN: ORIGINS.portal,
  });
  const logger = createLogger({ level: 'info', destination: logs.stream });
  auth = createAuth(settings, {
    database: {
      host: api.host,
      port: api.port,
      database: api.database,
      password: new Secret(api.password),
    },
    log: logger,
    sender,
    commonPasswords: new Set(['synthetic common password']),
  });
  app = await buildApp({ logger, checkDatabase: () => Promise.resolve(), auth });
  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
});

afterEach(() => {
  vi.useRealTimers();
  sendResult = { sent: true };
});

afterAll(async () => {
  await app.close();
  await auth.close();
});

describe('a passkey as a factor at sign-in', { timeout: 120_000 }, () => {
  it('makes a console or portal sign-in wait for MFA, from either app', async () => {
    const staff = await addUser([tenantA]);
    const applicant = await addUser([]);
    await addPasskey(staff.userId);
    expect((await signIn(tenantA, staff)).mfa).toBe('verify');
    expect((await signIn(tenantA, applicant, 'portal')).mfa).toBe('not_required');
    await addPasskey(applicant.userId);
    expect((await signIn(tenantA, applicant, 'portal')).mfa).toBe('verify');
    expect((await signIn(tenantB, applicant, 'portal')).mfa).toBe('verify');
  });
});

describe('listing passkeys', { timeout: 120_000 }, () => {
  it('lists the session user’s own, by id, name and times alone', async () => {
    const user = await addUser([tenantA]);
    const other = await addUser([tenantA]);
    const [first, second] = [await addPasskey(user.userId), await addPasskey(user.userId, 'Phone')];
    await addPasskey(other.userId, 'Not yours');
    const response = await list(await signedIn(tenantA, user));
    expect(response.statusCode).toBe(200);
    const { passkeys } = response.json<{ passkeys: Record<string, unknown>[] }>();
    expect(passkeys.map((passkey) => [passkey['id'], passkey['name']])).toEqual([
      [first, 'Work laptop'],
      [second, 'Phone'],
    ]);
    expect(Object.keys(passkeys[0] ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'lastUsedAt',
      'name',
    ]);
  });

  it('needs a complete session', async () => {
    const user = await addUser([tenantA]);
    await addPasskey(user.userId);
    const { token } = await signIn(tenantA, user);
    expect((await list(token)).statusCode).toBe(401);
  });
});

describe('removing a passkey', { timeout: 120_000 }, () => {
  it('needs a session that re-authenticated within 5 minutes', async () => {
    const user = await addUser([tenantA]);
    await addTotp(user.userId);
    const id = await addPasskey(user.userId);
    const token = await signedIn(tenantA, user);
    const now = Date.now();
    await migrator(
      'UPDATE auth.session SET reauthenticated_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [user.userId, new Date(now)],
    );
    vi.useFakeTimers({ toFake: ['Date'], now: now + 5 * 60_000 + 1000 });
    expect((await remove(token, id)).statusCode).toBe(403);
    vi.setSystemTime(now + 4 * 60_000 + 59_000);
    expect((await remove(token, id)).statusCode).toBe(204);
    expect(await passkeyIds(user.userId)).toEqual([]);
  });

  it.each(['the same tenant', 'another tenant'])(
    'answers for another user’s passkey, in %s, as for an unknown id, and keeps it',
    async (where) => {
      const user = await addUser([tenantA]);
      await addTotp(user.userId);
      const owner = await addUser([where === 'the same tenant' ? tenantA : tenantB]);
      const theirs = await addPasskey(owner.userId);
      const token = await signedIn(tenantA, user);
      for (const id of [theirs, randomUUID()]) {
        const response = await remove(token, id);
        expect(response.statusCode).toBe(404);
        expect(response.body).not.toContain(id);
      }
      expect(await passkeyIds(owner.userId)).toEqual([theirs]);
      expect(await events(user.userId)).toEqual([]);
      expect((await session(token)).statusCode).toBe(200);
    },
  );

  it('takes no body, so no user id', async () => {
    const user = await addUser([]);
    const owner = await addUser([]);
    const theirs = await addPasskey(owner.userId);
    const token = await signedIn(tenantA, user, 'portal');
    const response = await call(
      'DELETE',
      `/auth/passkeys/${theirs}`,
      token,
      { userId: owner.userId },
      'portal',
    );
    expect(response.statusCode).toBe(400);
    expect(await passkeyIds(owner.userId)).toEqual([theirs]);
  });

  it('refuses a session that has not proven the account’s factor', async () => {
    const user = await addUser([]);
    const { token } = await signIn(tenantA, user, 'portal');
    // Added since that password-only sign-in.
    const id = await addPasskey(user.userId);
    const response = await remove(token, id, 'portal');
    expect(response.statusCode).toBe(403);
    expect(await passkeyIds(user.userId)).toEqual([id]);
  });

  it('refuses staff whose only factor it is, and lets them remove one of two', async () => {
    const user = await addUser([tenantA]);
    const only = await addPasskey(user.userId);
    let token = await signedIn(tenantA, user);
    const refused = await remove(token, only);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ detail: string }>().detail).toMatch(/Add one first/);
    expect(await passkeyIds(user.userId)).toEqual([only]);

    // Staff in another tenant are refused from this tenant's portal too.
    const portal = await signedIn(tenantB, user, 'portal');
    expect((await remove(portal, only, 'portal')).statusCode).toBe(409);

    const spare = await addPasskey(user.userId, 'Spare key');
    token = await signedIn(tenantA, user);
    expect((await remove(token, only)).statusCode).toBe(204);
    expect(await passkeyIds(user.userId)).toEqual([spare]);
  });

  it('lets an applicant remove their only factor, which revokes everything, even if the email fails', async () => {
    const user = await addUser([]);
    const id = await addPasskey(user.userId, 'Kitchen tablet');
    const token = await signedIn(tenantA, user, 'portal');
    const other = await signedIn(tenantA, user, 'portal');
    sendResult = { sent: false, code: 'failed' };
    sent.length = 0;

    const response = await remove(token, id, 'portal');
    expect(response.statusCode).toBe(204);
    expect(String(response.headers['set-cookie'])).toMatch(/__Host-tps_portal_session=;/);
    expect((await session(other, 'portal')).statusCode).toBe(401);
    expect(await passkeyIds(user.userId)).toEqual([]);
    expect(await events(user.userId)).toEqual([
      { code: 'passkey_removed', reason: 'passkey', tenant_id: tenantA.id },
      { code: 'sessions_revoked', reason: 'mfa_removed', tenant_id: tenantA.id },
    ]);
    expect(await copies(tenantA, user.userId)).toEqual(
      expect.arrayContaining(['platform.auth.passkey_removed', 'platform.auth.sessions_revoked']),
    );
    const notice = await vi.waitFor(() => {
      const found = sent.find((email) => email.to === user.email);
      expect(found).toBeDefined();
      return found;
    });
    expect(notice?.subject).toMatch(/A passkey was removed/);
    expect(notice?.text).toContain('"Kitchen tablet"');
    expect(notice?.text).not.toMatch(/https?:/);
    // Without a factor, the next portal sign-in needs none.
    expect((await signIn(tenantA, user, 'portal')).mfa).toBe('not_required');
  });

  it('puts no credential id or public key in a response or log line', () => {
    const text = logs.text();
    expect(credentials.length).toBeGreaterThan(0);
    for (const secretish of [...credentials, PUBLIC_KEY]) {
      expect(text).not.toContain(secretish);
      for (const body of bodies) expect(body).not.toContain(secretish);
    }
  });
});
