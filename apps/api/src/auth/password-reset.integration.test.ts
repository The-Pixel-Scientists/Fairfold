// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Password reset against the test database (ADR 0010): identical answers for
// every address, links kept only as hashes with the token in the fragment,
// single use under a race, expiry, every other link and every session ended,
// the sign-in counters cleared, MFA untouched, the email limit, and the auth
// events, and no session outliving a reset that raced its issue. Emails go
// to a fake sender; the common-password list is a small synthetic one. Each
// test uses its own addresses, so counters never meet.

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { createDatabase } from '@pixel-scientists/db';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectionSettings, withClient } from '../../../../packages/db/test/connect.ts';
import {
  createTestTenant,
  testSlug,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { captureLogs } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { Secret } from '../config.ts';
import type { Email, Sender } from '../email/sender.ts';
import { createLogger } from '../logger.ts';
import { hashToken, newToken, readToken, SESSION_COOKIES } from './cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from './index.ts';
import type * as Passwords from './passwords.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { lockSession, rotateSession } from './sessions.ts';

vi.mock('./passwords.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Passwords>();
  return {
    ...actual,
    hashPassword: vi.fn(actual.hashPassword),
    verifyPassword: vi.fn(actual.verifyPassword),
  };
});

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const HOSTS = { console: 'console.example.org', portal: 'apply.example.org' } as const;
type AppName = keyof typeof HOSTS;

const OLD_PASSWORD = 'the old synthetic passphrase';
const NEW_PASSWORD = 'a new synthetic passphrase';
const COMMON = 'Synthetic Common Password';

let app: FastifyInstance;
let auth: Auth;
let tenant: TestTenant;
const logs = captureLogs();
const sent: Email[] = [];
let gate: Promise<void> | undefined;

const sender: Sender = {
  async send(email) {
    await gate;
    sent.push(email);
    return { sent: true };
  },
};

const newAddress = () => `10.${[...randomBytes(3)].join('.')}`;
const newEmail = () => `${testSlug()}@example.test`;

function post(url: string, payload: object, options: { app?: AppName; ip?: string } = {}) {
  const target = options.app ?? 'portal';
  return app.inject({
    method: 'POST',
    url: `/api${url}`,
    payload,
    remoteAddress: options.ip ?? newAddress(),
    headers: { host: HOSTS[target], origin: ORIGINS[target] },
  });
}

const requestReset = (email: string, options?: { app?: AppName; ip?: string }) =>
  post(`/auth/tenants/${tenant.slug}/password-reset`, { email }, options);
const completeReset = (token: string, password = NEW_PASSWORD, ip?: string) =>
  post('/auth/password-reset/complete', { token, password }, ip === undefined ? {} : { ip });
const signIn = (email: string, password: string, options?: { app?: AppName; ip?: string }) =>
  post(`/auth/tenants/${tenant.slug}/sign-in`, { email, password }, options);

async function emailTo(to: string, count = 1): Promise<Email> {
  return vi.waitFor(
    () => {
      const found = sent.filter((email) => email.to === to);
      if (found.length < count) throw new Error(`No email to ${to} yet.`);
      return found[found.length - 1] as Email;
    },
    { timeout: 10_000 },
  );
}

const tokenIn = (email: Email) => /#token=([A-Za-z0-9_-]+)/.exec(email.text)?.[1] ?? '';
const tokenId = (token: string) => createHash('sha256').update(token).digest('base64url');

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

async function addAccount(email: string): Promise<string> {
  const hash = await hashPassword(OLD_PASSWORD);
  return withClient('app_auth', async (client) => {
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
}

/** An account and a reset link for it. */
async function accountWithLink(): Promise<{ email: string; userId: string; token: string }> {
  const email = newEmail();
  const userId = await addAccount(email);
  await requestReset(email);
  return { email, userId, token: tokenIn(await emailTo(email)) };
}

/** A reset link written straight to the table, issued and expiring at times relative to now. */
async function linkAt(userId: string, issued: string, expires: string): Promise<string> {
  const token = newToken();
  await migrator(
    `INSERT INTO auth.verification (identifier, value, created_at, expires_at)
     VALUES ($1, $2, now() + $3::interval, now() + $4::interval)`,
    [tokenId(token), `password_reset:${userId}:${tenant.id}`, issued, expires],
  );
  return token;
}

function shape(response: LightMyRequestResponse) {
  const headers = Object.fromEntries(
    Object.entries(response.headers).filter(([name]) => !['date', 'x-request-id'].includes(name)),
  );
  const body = response.body === '' ? '' : { ...response.json<object>(), requestId: undefined };
  return { status: response.statusCode, headers, body };
}

const passwordOf = async (userId: string) =>
  (
    await migrator<{ password: string }>(`SELECT password FROM auth.account WHERE user_id = $1`, [
      userId,
    ])
  )[0]?.password ?? '';

beforeAll(async () => {
  const api = connectionSettings('app_api');
  const appAuth = connectionSettings('app_auth');
  const settings = loadAuthSettings({
    TPS_DEV: '1',
    TPS_DB_HOST: api.host,
    TPS_AUTH_SECRET: newToken(),
    TPS_DB_APP_AUTH_PASSWORD: appAuth.password,
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
    commonPasswords: new Set([COMMON.toLowerCase()]),
  });
  app = await buildApp({ logger, checkDatabase: () => Promise.resolve(), auth });
  tenant = await createTestTenant();
});

afterAll(async () => {
  gate = undefined;
  await app.close();
  await auth.close();
});

describe('asking for a reset link', { timeout: 60_000 }, () => {
  it('answers the same for an account, a pending sign-up and an unknown address, without waiting', async () => {
    const known = newEmail();
    await addAccount(known);
    const pending = newEmail();
    await post(`/auth/tenants/${tenant.slug}/sign-up`, { email: pending });
    await emailTo(pending);
    const unknown = newEmail();

    let open = () => {};
    gate = new Promise((resolve) => (open = resolve));
    const responses = [
      await requestReset(known),
      await requestReset(pending),
      await requestReset(unknown),
    ];
    open();
    gate = undefined;

    const [first, ...rest] = responses.map(shape);
    expect(first?.status).toBe(202);
    for (const other of rest) expect(other).toEqual(first);
    expect(tokenIn(await emailTo(known))).not.toBe('');
    // The later work records each request; only the account's gets an email.
    await vi.waitFor(
      async () => {
        const rows = await migrator(
          `SELECT 1 FROM auth.audit_event WHERE code = 'password_reset_requested'
              AND identifier = ANY($1)`,
          [[pending, unknown]],
        );
        expect(rows).toHaveLength(2);
      },
      { timeout: 10_000 },
    );
    expect(sent.filter((email) => email.to === unknown)).toEqual([]);
    expect(sent.filter((email) => email.to === pending)).toHaveLength(1);
  });

  it('emails a link to the reset page of the asking app, the token only in its fragment, kept as a hash for 30 minutes', async () => {
    const email = newEmail();
    const userId = await addAccount(email);
    expect((await requestReset(email, { app: 'console' })).statusCode).toBe(202);
    const message = await emailTo(email);
    expect(message.subject).toBe('Reset your Fairfold Grants password');
    const token = tokenIn(message);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(message.text).toContain(
      `${ORIGINS.console}/${tenant.slug}/reset-password#token=${token}`,
    );
    expect(message.text.split(token)).toHaveLength(2);

    const rows = await migrator<{ identifier: string; value: string; minutes: string }>(
      `SELECT identifier, value, round(extract(epoch FROM expires_at - created_at) / 60) AS minutes
         FROM auth.verification WHERE value LIKE $1`,
      [`password_reset:${userId}:%`],
    );
    expect(rows).toEqual([
      {
        identifier: tokenId(token),
        value: `password_reset:${userId}:${tenant.id}`,
        minutes: '30',
      },
    ]);
  });

  it('allows 3 emails an hour to an address, unknown ones alike, and 20 from a client', async () => {
    const known = newEmail();
    await addAccount(known);
    const unknown = newEmail();
    const refused: LightMyRequestResponse[] = [];
    for (const email of [known, unknown]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        expect((await requestReset(email)).statusCode).toBe(202);
      }
      refused.push(await requestReset(email));
    }
    expect(refused[0]?.statusCode).toBe(429);
    const [a, b] = refused.map(shape);
    expect({ ...a, headers: { ...a?.headers, 'retry-after': '' } }).toEqual({
      ...b,
      headers: { ...b?.headers, 'retry-after': '' },
    });
    expect(Number(refused[1]?.headers['retry-after'])).toBeGreaterThan(3500);

    const ip = newAddress();
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await requestReset(newEmail(), { ip })).statusCode).toBe(202);
    }
    expect((await requestReset(newEmail(), { ip })).statusCode).toBe(429);
  });

  it('leaves Better Auth’s reset endpoints unmounted', async () => {
    for (const [method, url] of [
      ['GET', '/api/auth/reset-password/abc'],
      ['POST', '/api/auth/reset-password'],
      ['POST', '/api/auth/request-password-reset'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { host: HOSTS.portal, origin: ORIGINS.portal, 'content-type': 'application/json' },
        ...(method === 'POST' ? { payload: '{}' } : {}),
      });
      expect(response.statusCode, url).toBe(404);
    }
  });
});

describe('completing a reset', { timeout: 60_000 }, () => {
  it('sets the password, ends every session and link, clears sign-in counters, notifies, and does not sign in', async () => {
    const { email, userId, token } = await accountWithLink();
    await requestReset(email);
    const other = tokenIn(await emailTo(email, 2));
    const portal = await signIn(email, OLD_PASSWORD);
    const cookie = String(portal.headers['set-cookie']).split(';')[0] ?? '';
    await signIn(email, OLD_PASSWORD, { app: 'console' });
    const ip = newAddress();
    for (let attempt = 0; attempt < 3; attempt++) await signIn(email, 'not the password', { ip });
    const counters = () =>
      migrator<{ scope: string }>(
        `SELECT DISTINCT scope FROM auth.rate_limit WHERE identifier = $1 ORDER BY scope`,
        [email],
      );
    expect((await counters()).map((row) => row.scope)).toEqual([
      'email_identifier',
      'sign_in_identifier',
      'sign_in_identifier_ip',
    ]);

    const response = await completeReset(token, NEW_PASSWORD, '203.0.113.40');
    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await verifyPassword(await passwordOf(userId), NEW_PASSWORD)).toBe(true);
    expect(
      await migrator(`SELECT 1 FROM auth.session WHERE user_id = $1 AND revoked_at IS NULL`, [
        userId,
      ]),
    ).toEqual([]);
    const session = await app.inject({
      url: '/api/auth/session',
      headers: { host: HOSTS.portal, cookie },
    });
    expect(session.statusCode).toBe(401);
    expect((await counters()).map((row) => row.scope)).toEqual(['email_identifier']);
    expect((await completeReset(other)).statusCode).toBe(400);
    expect(
      await migrator(`SELECT 1 FROM auth.verification WHERE value LIKE $1`, [
        `password_reset:${userId}:%`,
      ]),
    ).toEqual([]);

    const notice = await emailTo(email, 3);
    expect(notice.subject).toBe('Your Fairfold Grants password has changed');
    expect(notice.text).not.toContain('#token=');
    expect((await signIn(email, OLD_PASSWORD)).statusCode).toBe(401);
    expect((await signIn(email, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('records each step with its tenant, ready for the copy, and nothing secret', async () => {
    const { email, userId, token } = await accountWithLink();
    await completeReset(token, NEW_PASSWORD, '203.0.113.41');
    const events = await migrator<{
      id: string;
      code: string;
      identifier: string | null;
      tenant_id: string;
      reason: string | null;
      ip: string;
    }>(
      `SELECT id, code, identifier, tenant_id, reason, host(ip_address) AS ip FROM auth.audit_event
        WHERE user_id = $1
          AND code IN ('password_reset_requested', 'password_reset_completed', 'sessions_revoked')
        ORDER BY occurred_at, code`,
      [userId],
    );
    expect(events).toMatchObject([
      {
        code: 'password_reset_requested',
        identifier: email,
        tenant_id: tenant.id,
        reason: null,
      },
      {
        code: 'password_reset_completed',
        identifier: email,
        tenant_id: tenant.id,
        reason: null,
        ip: '203.0.113.41',
      },
      {
        code: 'sessions_revoked',
        identifier: null,
        tenant_id: tenant.id,
        reason: 'password_reset',
        ip: '203.0.113.41',
      },
    ]);
    const pending = await migrator(
      `SELECT 1 FROM auth.audit_copy_pending WHERE auth_event_id = ANY($1)`,
      [events.map((event) => event.id)],
    );
    expect(pending).toHaveLength(3);
    for (const secret of [token, NEW_PASSWORD, tokenId(token)]) {
      expect(logs.text().includes(secret)).toBe(false);
    }
  });

  it('works once: a second use, a made-up token and a token from a sign-up are refused, unhashed', async () => {
    const { token } = await accountWithLink();
    expect((await completeReset(token)).statusCode).toBe(204);
    vi.mocked(hashPassword).mockClear();
    const again = await completeReset(token);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({
      detail: 'This link is not valid. Use the link in your latest email, or ask for a new one.',
    });
    expect((await completeReset(newToken())).statusCode).toBe(400);

    const signUp = newEmail();
    await post(`/auth/tenants/${tenant.slug}/sign-up`, { email: signUp });
    expect((await completeReset(tokenIn(await emailTo(signUp)))).statusCode).toBe(400);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('expires 30 minutes after it is issued, by the database clock', async () => {
    const email = newEmail();
    const userId = await addAccount(email);
    const expired = await linkAt(userId, '-31 minutes', '-1 minute');
    const live = await linkAt(userId, '-29 minutes', '1 minute');
    expect((await completeReset(expired)).statusCode).toBe(400);
    expect((await completeReset(live)).statusCode).toBe(204);
  });

  it('lets exactly one of two racing completions with one token succeed', async () => {
    const { userId, token } = await accountWithLink();
    const statuses = (
      await Promise.all([
        completeReset(token, NEW_PASSWORD),
        completeReset(token, `${NEW_PASSWORD} 2`),
      ])
    ).map((response) => response.statusCode);
    expect(statuses.sort()).toEqual([204, 400]);
    const completed = await migrator(
      `SELECT 1 FROM auth.audit_event WHERE code = 'password_reset_completed' AND user_id = $1`,
      [userId],
    );
    expect(completed).toHaveLength(1);
  });

  it('lets one of two racing links for an account succeed', async () => {
    const email = newEmail();
    const userId = await addAccount(email);
    const first = await linkAt(userId, '-1 minute', '29 minutes');
    const second = await linkAt(userId, '-1 minute', '29 minutes');
    const statuses = (await Promise.all([completeReset(first), completeReset(second)])).map(
      (response) => response.statusCode,
    );
    expect(statuses.sort()).toEqual([204, 400]);
  });

  it('refuses a common password and leaves the token usable', async () => {
    const { userId, token } = await accountWithLink();
    const refused = await completeReset(token, COMMON.toUpperCase());
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ errors: [{ field: 'body.password' }] });
    expect((await completeReset(token, 'too short')).statusCode).toBe(400);
    expect(await verifyPassword(await passwordOf(userId), OLD_PASSWORD)).toBe(true);
    expect((await completeReset(token)).statusCode).toBe(204);
  });

  it('leaves MFA alone, so a staff sign-in still asks for a code', async () => {
    const { email, userId, token } = await accountWithLink();
    const secret = 'b'.repeat(80);
    await withClient('app_auth', (client) =>
      client.query(
        'INSERT INTO auth.two_factor (user_id, secret, verified) VALUES ($1, $2, true)',
        [userId, secret],
      ),
    );
    expect((await completeReset(token)).statusCode).toBe(204);
    const staff = await signIn(email, NEW_PASSWORD, { app: 'console' });
    expect(staff.json()).toMatchObject({ app: 'console', mfa: 'verify' });
    expect(
      await migrator(`SELECT secret, verified FROM auth.two_factor WHERE user_id = $1`, [userId]),
    ).toEqual([{ secret, verified: true }]);
  });
});

describe('a reset racing a session being issued', { timeout: 60_000 }, () => {
  const liveSessions = (userId: string) =>
    migrator(`SELECT 1 FROM auth.session WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);

  it('refuses a sign-in whose old password was being checked while the reset completed', async () => {
    const { email, userId, token } = await accountWithLink();
    const actual = await vi.importActual<typeof Passwords>('./passwords.ts');
    let checked = () => {};
    const checking = new Promise<void>((resolve) => (checked = resolve));
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(verifyPassword).mockImplementationOnce(async (phc, password) => {
      const matched = await actual.verifyPassword(phc, password);
      checked();
      await held;
      return matched;
    });

    const attempt = signIn(email, OLD_PASSWORD);
    await checking;
    expect((await completeReset(token)).statusCode).toBe(204);
    release();
    const response = await attempt;
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await liveSessions(userId)).toEqual([]);
    expect(
      await migrator(
        `SELECT 1 FROM auth.audit_event
          WHERE code = 'sign_in_failed' AND reason = 'bad_password' AND user_id = $1`,
        [userId],
      ),
    ).toHaveLength(1);
  });

  it('revokes the session a rotation issued while the reset waited for it', async () => {
    const { email, userId, token } = await accountWithLink();
    const old = readToken(
      String((await signIn(email, OLD_PASSWORD)).headers['set-cookie']),
      'portal',
    );
    const settings = connectionSettings('app_auth');
    const db = createDatabase<unknown>({
      host: settings.host,
      port: settings.port,
      database: settings.database,
      role: 'app_auth',
      password: settings.password,
      applicationName: 'tps-db-tests',
      maxConnections: 1,
    });
    try {
      let locked: (pid: number) => void = () => {};
      const holding = new Promise<number>((resolve) => (locked = resolve));
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      const rotation = db.transaction().execute(async (trx) => {
        const { pid } = await trx
          .selectNoFrom((eb) => eb.fn<number>('pg_backend_pid').as('pid'))
          .executeTakeFirstOrThrow();
        const current = await lockSession(trx, userId, hashToken(old ?? ''));
        if (current === undefined) throw new Error('The session to rotate is not live.');
        locked(pid);
        await held;
        return rotateSession(trx, current, { ip: '203.0.113.50' });
      });

      const pid = await holding;
      const reset = completeReset(token);
      await vi.waitFor(
        async () => {
          const blocked = await migrator(
            `SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))`,
            [pid],
          );
          expect(blocked).not.toEqual([]);
        },
        { timeout: 10_000 },
      );
      release();
      const rotated = await rotation;
      expect((await reset).statusCode).toBe(204);
      expect(await liveSessions(userId)).toEqual([]);
      const session = await app.inject({
        url: '/api/auth/session',
        headers: { host: HOSTS.portal, cookie: `${SESSION_COOKIES.portal}=${rotated}` },
      });
      expect(session.statusCode).toBe(401);
    } finally {
      await db.destroy();
    }
  });
});

describe('the auth tables', { timeout: 60_000 }, () => {
  it('hold no reset token or new password in clear', async () => {
    const { token } = await accountWithLink();
    const password = `clear text check ${randomUUID()}`;
    expect((await completeReset(token, password)).statusCode).toBe(204);
    const tables = await migrator<{ name: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname = 'auth'`,
    );
    for (const { name } of tables) {
      const rows = await migrator<{ row: string }>(`SELECT t::text AS row FROM ${name} t`);
      const text = rows.map((r) => r.row).join('\n');
      for (const secret of [token, password]) {
        expect(text.includes(secret), `${name} holds a secret`).toBe(false);
      }
    }
  });
});
