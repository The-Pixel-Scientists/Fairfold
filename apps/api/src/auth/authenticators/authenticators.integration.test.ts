// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Replacing and removing the authenticator app, against the test database
// (ADR 0010): an applicant's optional one, step-up on a clock, the pending
// secret beside the current one, one use of the confirming code, the
// last-factor rule across tenants, and everything revoked, recorded, copied
// and emailed, with no secret or code anywhere it should not be.

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
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
import { codeAt, stepAt } from '../totp.ts';

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const HOSTS = { console: 'console.example.org', portal: 'apply.example.org' } as const;
type AppName = keyof typeof HOSTS;
/** Each app's session cookie in a Set-Cookie header. */
const SESSION_COOKIE: Record<AppName, RegExp> = {
  console: /__Host-tps_console_session=([^;]*);/,
  portal: /__Host-tps_portal_session=([^;]*);/,
};
const PASSWORD = 'a long synthetic passphrase';
/** Hex in the stored form's shape, for a secret no test decrypts. */
const STORED_SECRET = 'ab'.repeat(60);

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

const start = (token: string, target: AppName = 'console') =>
  call('POST', '/auth/account/totp/start', token, undefined, target);
const confirm = (token: string, code: string, target: AppName = 'console') =>
  call('POST', '/auth/account/totp/confirm', token, { code }, target);
const remove = (token: string, target: AppName = 'console') =>
  call('DELETE', '/auth/account/totp', token, undefined, target);
const session = (token: string, target: AppName = 'console') =>
  call('GET', '/auth/session', token, undefined, target);

const tokenOf = (response: LightMyRequestResponse, target: AppName = 'console') =>
  SESSION_COOKIE[target].exec(String(response.headers['set-cookie']))?.[1];

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

function fromBase32(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of text) {
    value = ((value << 5) | alphabet.indexOf(char)) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** Waits for a new time step if this one ends within 8 seconds, so a test's codes stay in one. */
async function freshStep(): Promise<number> {
  const left = 30_000 - (Date.now() % 30_000);
  if (left < 8000) await delay(left + 100);
  return stepAt(Date.now());
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

/** Give the user a confirmed authenticator that no test reads codes from. */
const addTotp = (userId: string) =>
  withClient('app_auth', async (client) => {
    await client.query(
      'INSERT INTO auth.two_factor (user_id, secret, verified) VALUES ($1, $2, true)',
      [userId, STORED_SECRET],
    );
    await client.query('UPDATE auth."user" SET two_factor_enabled = true WHERE id = $1', [userId]);
  });

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
  return tokenOf(response, target) ?? '';
}

/** A complete console session with a confirmed authenticator. */
async function signedIn(tenant: TestTenant, user: User) {
  const pending = await signIn(tenant, user);
  const key = (await call('POST', '/auth/totp/enrol', pending)).json<{ key: string }>().key;
  const secret = fromBase32(key);
  const step = await freshStep();
  const confirmed = await call(
    'POST',
    '/auth/totp/confirm',
    pending,
    { code: codeAt(secret, step - 1) },
    'console',
    user.ip,
  );
  expect(confirmed.statusCode).toBe(200);
  return { token: tokenOf(confirmed) ?? '', secret, step };
}

/** Sign in again and send each code in turn while waiting for one: their statuses. */
async function verifyWith(tenant: TestTenant, user: User, codes: string[]) {
  const pending = await signIn(tenant, user);
  const statuses = [];
  for (const code of codes) {
    const response = await call('POST', '/auth/totp/verify', pending, { code }, 'console', user.ip);
    statuses.push(response.statusCode);
  }
  return statuses;
}

/**
 * Mark the user's portal sessions as having proven their factor, as a portal
 * session that verified a code would be, for a secret no test reads codes from.
 */
const proveFactor = (userId: string) =>
  migrator(
    `UPDATE auth.session SET mfa_state = 'complete'
      WHERE user_id = $1 AND app = 'portal' AND revoked_at IS NULL`,
    [userId],
  );

const passwordHash = (userId: string) =>
  migrator<{ password: string }>(
    "SELECT password FROM auth.account WHERE user_id = $1 AND provider_id = 'credential'",
    [userId],
  );

const changePassword = (token: string, target: AppName) =>
  call('POST', '/auth/account/password', token, { password: 'another long passphrase' }, target);

const twoFactor = (userId: string) =>
  migrator<{ secret: string; verified: boolean; last_used_step: string | null }>(
    'SELECT secret, verified, last_used_step FROM auth.two_factor WHERE user_id = $1',
    [userId],
  );

const events = (userId: string) =>
  migrator<{ code: string; reason: string | null; tenant_id: string | null }>(
    `SELECT code, reason, tenant_id FROM auth.audit_event WHERE user_id = $1
      AND code IN ('mfa_enrolled', 'mfa_removed', 'mfa_code_failed', 'sessions_revoked')
      ORDER BY occurred_at, code`,
    [userId],
  );

/** The tenant's copies of the user's auth events. */
const copies = (tenant: TestTenant, userId: string) =>
  asMigratorIn(tenant.id, async (client) =>
    (
      await client.query<{ action: string }>(
        `SELECT action FROM app.audit_event
          WHERE entity_id IN (SELECT id FROM auth.audit_event WHERE user_id = $1)
          ORDER BY action`,
        [userId],
      )
    ).rows.map((row) => row.action),
  );

const liveDevices = (userId: string) =>
  migrator<{ count: string }>(
    'SELECT count(*) FROM auth.device WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  ).then((rows) => Number(rows[0]?.count));

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

describe('changing the authenticator app', { timeout: 120_000 }, () => {
  it('needs a complete session that re-authenticated within 5 minutes', async () => {
    const user = await addUser([tenantA]);
    const waiting = await signIn(tenantA, user);
    expect((await start(waiting)).statusCode).toBe(401);
    expect((await remove(waiting)).statusCode).toBe(401);

    const { token } = await signedIn(tenantA, user);
    const now = Date.now();
    await migrator(
      'UPDATE auth.session SET reauthenticated_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [user.userId, new Date(now)],
    );
    vi.useFakeTimers({ toFake: ['Date'], now: now + 5 * 60_000 + 1000 });
    expect((await start(token)).statusCode).toBe(403);
    expect((await confirm(token, '000000')).statusCode).toBe(403);
    expect((await remove(token)).statusCode).toBe(403);
    vi.setSystemTime(now + 4 * 60_000 + 59_000);
    expect((await start(token)).statusCode).toBe(200);
  });

  it('keeps the current app until a code from the new one confirms it, then signs out everywhere', async () => {
    const user = await addUser([tenantA]);
    const { token, secret: old, step: signedInAt } = await signedIn(tenantA, user);
    const otherPending = await signIn(tenantA, user);
    const verified = await call(
      'POST',
      '/auth/totp/verify',
      otherPending,
      { code: codeAt(old, signedInAt) },
      'console',
      user.ip,
    );
    expect(verified.statusCode).toBe(200);
    const other = tokenOf(verified) ?? '';
    const before = await twoFactor(user.userId);

    const first = fromBase32((await start(token)).json<{ key: string }>().key);
    const started = await start(token);
    expect(started.statusCode).toBe(200);
    const { key } = started.json<{ key: string }>();
    const secret = fromBase32(key);
    expect(await twoFactor(user.userId)).toEqual(before);
    const pending = await migrator<{ value: string }>(
      "SELECT value FROM auth.verification WHERE value LIKE 'totp_change:' || $1 || ':%'",
      [user.userId],
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.value).not.toContain(key);
    expect(pending[0]?.value).not.toContain(secret.toString('utf8'));

    const step = await freshStep();
    // A wrong code, and one from the replaced pending secret, change nothing.
    for (const code of [codeAt(old, step), codeAt(first, step)]) {
      const refused = await confirm(token, code);
      expect(refused.statusCode).toBe(400);
      expect(refused.body).not.toContain(code);
    }
    expect(await twoFactor(user.userId)).toEqual(before);
    expect((await session(token)).statusCode).toBe(200);

    const done = await confirm(token, codeAt(secret, step));
    expect(done.statusCode).toBe(204);
    expect(String(done.headers['set-cookie'])).toMatch(/__Host-tps_console_session=;.*Max-Age=0/);
    expect((await session(token)).statusCode).toBe(401);
    expect((await session(other)).statusCode).toBe(401);
    expect(await liveDevices(user.userId)).toBe(0);
    const [after] = await twoFactor(user.userId);
    expect(after?.verified).toBe(true);
    expect(after?.secret).not.toBe(before[0]?.secret);
    expect(after?.secret).not.toContain(key);
    expect(Number(after?.last_used_step)).toBe(step);

    // The confirming code and the old app's codes no longer sign in; the new app's next one does.
    expect(
      await verifyWith(tenantA, user, [
        codeAt(secret, step),
        codeAt(old, step + 1),
        codeAt(secret, step + 1),
      ]),
    ).toEqual([401, 401, 200]);

    expect((await events(user.userId)).filter((e) => e.code !== 'mfa_code_failed')).toEqual(
      expect.arrayContaining([
        { code: 'mfa_enrolled', reason: 'totp_change', tenant_id: tenantA.id },
        { code: 'sessions_revoked', reason: 'mfa_changed', tenant_id: tenantA.id },
      ]),
    );
    expect(await copies(tenantA, user.userId)).toEqual(
      expect.arrayContaining(['platform.auth.mfa_enrolled', 'platform.auth.sessions_revoked']),
    );
    const notice = await vi.waitFor(() => {
      const found = sent.find(
        (email) => email.to === user.email && / was changed$/.test(email.subject),
      );
      expect(found).toBeDefined();
      return found;
    });
    expect(notice?.subject).toMatch(/authenticator app/);
    expect(notice?.text).not.toMatch(/https?:/);
  });

  it('accepts the confirming code once when two requests send it together', async () => {
    const user = await addUser([tenantA]);
    const { token } = await signedIn(tenantA, user);
    const secret = fromBase32((await start(token)).json<{ key: string }>().key);
    const code = codeAt(secret, await freshStep());
    const statuses = (await Promise.all([confirm(token, code), confirm(token, code)])).map(
      (response) => response.statusCode,
    );
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
  });

  it('takes nothing but the code from the body', async () => {
    const user = await addUser([tenantA]);
    const other = await addUser([tenantA]);
    const { token } = await signedIn(tenantA, user);
    await start(token);
    const response = await call('POST', '/auth/account/totp/confirm', token, {
      code: '000000',
      userId: other.userId,
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('removing the authenticator app', { timeout: 120_000 }, () => {
  it('refuses staff whose only factor it is, with what to do', async () => {
    const user = await addUser([tenantA]);
    const { token } = await signedIn(tenantA, user);
    const before = await twoFactor(user.userId);
    const response = await remove(token);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ detail: string }>().detail).toMatch(/Add one first/);
    expect(await twoFactor(user.userId)).toEqual(before);
    expect((await session(token)).statusCode).toBe(200);
  });

  it('refuses staff in another tenant signed in to this tenant’s portal', async () => {
    const user = await addUser([tenantB]);
    await addTotp(user.userId);
    const portal = await signIn(tenantA, user, 'portal');
    await proveFactor(user.userId);
    expect((await remove(portal, 'portal')).statusCode).toBe(409);
    expect(await twoFactor(user.userId)).toEqual([
      { secret: STORED_SECRET, verified: true, last_used_step: null },
    ]);
  });

  it('lets an applicant remove it, which revokes everything for them alone, even if the email fails', async () => {
    const user = await addUser([]);
    const bystander = await addUser([tenantB], ['applicant']);
    await Promise.all([addTotp(user.userId), addTotp(bystander.userId)]);
    const token = await signIn(tenantA, user, 'portal');
    const other = await signIn(tenantA, user, 'portal');
    const bystanderToken = await signIn(tenantB, bystander, 'portal');
    // A password alone does not remove the factor it guards: the session waits for it.
    expect((await remove(token, 'portal')).statusCode).toBe(401);
    await proveFactor(user.userId);
    sendResult = { sent: false, code: 'failed' };
    sent.length = 0;

    expect(
      (await call('DELETE', '/auth/account/totp', token, { userId: bystander.userId }, 'portal'))
        .statusCode,
    ).toBe(400);
    const response = await remove(token, 'portal');
    expect(response.statusCode).toBe(204);
    expect(String(response.headers['set-cookie'])).toMatch(/__Host-tps_portal_session=;/);
    expect((await session(other, 'portal')).statusCode).toBe(401);
    const [after] = await twoFactor(user.userId);
    expect(after?.verified).toBe(false);
    expect(after?.secret).not.toBe(STORED_SECRET);
    const [flag] = await migrator<{ two_factor_enabled: boolean }>(
      'SELECT two_factor_enabled FROM auth."user" WHERE id = $1',
      [user.userId],
    );
    expect(flag?.two_factor_enabled).toBe(false);
    expect(await events(user.userId)).toEqual([
      { code: 'mfa_removed', reason: 'totp', tenant_id: tenantA.id },
      { code: 'sessions_revoked', reason: 'mfa_removed', tenant_id: tenantA.id },
    ]);
    expect(await copies(tenantA, user.userId)).toEqual(
      expect.arrayContaining(['platform.auth.mfa_removed', 'platform.auth.sessions_revoked']),
    );
    await vi.waitFor(() => {
      expect(sent.map((email) => email.to)).toContain(user.email);
    });

    // Nothing of the bystander's, in another tenant, changed.
    expect(await twoFactor(bystander.userId)).toEqual([
      { secret: STORED_SECRET, verified: true, last_used_step: null },
    ]);
    expect((await session(bystanderToken, 'portal')).statusCode).toBe(200);
  });

  it('puts no secret, code or token in a response, event or log line', () => {
    const text = logs.text();
    expect(text).not.toContain(STORED_SECRET);
    expect(text).not.toMatch(/totp_change:/);
    for (const body of bodies) expect(body).not.toContain(STORED_SECRET);
  });
});

describe('an applicant’s authenticator app', { timeout: 120_000 }, () => {
  it('is optional, and once set up, portal sign-in waits for its code', async () => {
    const user = await addUser([]);
    const token = await signIn(tenantA, user, 'portal');
    const secret = fromBase32((await start(token, 'portal')).json<{ key: string }>().key);
    const step = await freshStep();
    expect((await confirm(token, codeAt(secret, step), 'portal')).statusCode).toBe(204);
    expect(await events(user.userId)).toEqual([
      { code: 'mfa_enrolled', reason: 'totp_change', tenant_id: tenantA.id },
      { code: 'sessions_revoked', reason: 'mfa_changed', tenant_id: tenantA.id },
    ]);

    const pending = await signIn(tenantA, user, 'portal');
    expect((await session(pending, 'portal')).json<{ mfa: string }>().mfa).toBe('verify');
    const code = { code: codeAt(secret, step + 1) };
    const verified = await call('POST', '/auth/totp/verify', pending, code, 'portal', user.ip);
    expect(verified.statusCode).toBe(200);
    expect(verified.json<{ mfa: string }>().mfa).toBe('complete');
  });
});

describe('a session that has not proven the account’s factor', { timeout: 120_000 }, () => {
  it.each(['their own tenant', 'another tenant'])(
    'changes nothing for staff signed in to the portal of %s with the password alone',
    async (which) => {
      const user = await addUser([tenantB]);
      const { token: staff } = await signedIn(tenantB, user);
      const portal = await signIn(which === 'their own tenant' ? tenantB : tenantA, user, 'portal');
      // The owner has a replacement pending; the password alone must not confirm it.
      const pending = fromBase32((await start(staff)).json<{ key: string }>().key);
      const before = {
        twoFactor: await twoFactor(user.userId),
        password: await passwordHash(user.userId),
        events: await events(user.userId),
      };

      // Portal sign-in waits for the account's factor, so the policy refuses each.
      expect((await start(portal, 'portal')).statusCode).toBe(401);
      expect((await confirm(portal, codeAt(pending, await freshStep()), 'portal')).statusCode).toBe(
        401,
      );
      expect((await remove(portal, 'portal')).statusCode).toBe(401);
      expect((await changePassword(portal, 'portal')).statusCode).toBe(401);

      expect(await twoFactor(user.userId)).toEqual(before.twoFactor);
      expect(await passwordHash(user.userId)).toEqual(before.password);
      expect(await events(user.userId)).toEqual(before.events);
      expect((await session(staff)).statusCode).toBe(200);
      expect((await session(portal, 'portal')).statusCode).toBe(200);
    },
  );
});
