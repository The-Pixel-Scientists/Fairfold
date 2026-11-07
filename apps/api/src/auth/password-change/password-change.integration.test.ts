// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changing the password when signed in, against the test database (ADR
// 0010): step-up on a clock, the shared password rules, every other session
// and device cookie revoked while this browser goes on under a new session
// id and device cookie, the events and the notice, and the password or its
// hash nowhere it should not be.

import { randomBytes } from 'node:crypto';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectionSettings, withClient } from '../../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  testSlug,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { captureLogs } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { Secret } from '../../config.ts';
import type { Email, Sender } from '../../email/sender.ts';
import { createLogger } from '../../logger.ts';
import { newToken } from '../cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from '../index.ts';
import { hashPassword } from '../passwords.ts';

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const HOST = 'apply.example.org';
const PASSWORD = 'a long synthetic passphrase';
const NEW_PASSWORD = 'another long synthetic passphrase';
const COMMON = 'synthetic common password';

let app: FastifyInstance;
let auth: Auth;
let tenant: TestTenant;
const logs = captureLogs();
const sent: Email[] = [];
const sender: Sender = {
  send(email) {
    sent.push(email);
    return Promise.resolve({ sent: true });
  },
};
const bodies: string[] = [];

interface User {
  readonly email: string;
  readonly userId: string;
  readonly ip: string;
}

function post(path: string, payload: object, cookies: string[] = [], ip = '192.0.2.1') {
  return app
    .inject({
      method: 'POST',
      url: `/api${path}`,
      remoteAddress: ip,
      payload,
      headers: {
        host: HOST,
        origin: ORIGINS.portal,
        ...(cookies.length === 0 ? {} : { cookie: cookies.join('; ') }),
      },
    })
    .then((response) => {
      bodies.push(response.body);
      return response;
    });
}

const getSession = (token: string) =>
  app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: { host: HOST, cookie: `__Host-tps_portal_session=${token}` },
  });

/** The name=value pair of the response's Set-Cookie header named `name`, if any. */
function cookieNamed(response: LightMyRequestResponse, name: string): string | undefined {
  const headers = [response.headers['set-cookie'] ?? []].flat();
  return headers.find((header) => header.startsWith(`${name}=`))?.split(';', 1)[0];
}
const SESSION = '__Host-tps_portal_session';
const DEVICE = '__Host-tps_portal_device';
const tokenOf = (response: LightMyRequestResponse) =>
  cookieNamed(response, SESSION)?.slice(SESSION.length + 1) ?? '';

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

async function addUser(): Promise<User> {
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
  return { email, userId, ip: `10.${[...randomBytes(3)].join('.')}` };
}

const signIn = (user: User, password = PASSWORD) =>
  post(`/auth/tenants/${tenant.slug}/sign-in`, { email: user.email, password }, [], user.ip);

/** A portal session and its device cookie. */
async function signedIn(user: User) {
  const response = await signIn(user);
  expect(response.statusCode).toBe(200);
  return { token: tokenOf(response), device: cookieNamed(response, DEVICE) ?? '' };
}

const change = (token: string, payload: object, device?: string) =>
  post('/auth/account/password', payload, [
    `${SESSION}=${token}`,
    ...(device === undefined ? [] : [device]),
  ]);

const passwordHash = async (userId: string) =>
  (
    await migrator<{ password: string }>(
      "SELECT password FROM auth.account WHERE user_id = $1 AND provider_id = 'credential'",
      [userId],
    )
  )[0]?.password ?? '';

beforeAll(async () => {
  const api = connectionSettings('app_api');
  const settings = loadAuthSettings({
    TPS_DEV: '1',
    TPS_DB_HOST: api.host,
    TPS_AUTH_SECRET: newToken(),
    TPS_AUTH_BREACH_CHECK: 'off',
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
    commonPasswords: new Set([COMMON]),
  });
  app = await buildApp({ logger, checkDatabase: () => Promise.resolve(), auth });
  tenant = await createTestTenant();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await app.close();
  await auth.close();
});

describe('changing the password when signed in', { timeout: 120_000 }, () => {
  it('needs a session that re-authenticated within 5 minutes', async () => {
    const user = await addUser();
    const { token } = await signedIn(user);
    const now = Date.now();
    await migrator(
      'UPDATE auth.session SET reauthenticated_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [user.userId, new Date(now)],
    );
    const before = await passwordHash(user.userId);
    vi.useFakeTimers({ toFake: ['Date'], now: now + 5 * 60_000 + 1000 });
    expect((await change(token, { password: NEW_PASSWORD })).statusCode).toBe(403);
    expect(await passwordHash(user.userId)).toBe(before);
    vi.setSystemTime(now + 4 * 60_000 + 59_000);
    expect((await change(token, { password: NEW_PASSWORD })).statusCode).toBe(204);
  });

  it('refuses a common password with how to fix it, changing nothing', async () => {
    const user = await addUser();
    const { token } = await signedIn(user);
    const before = await passwordHash(user.userId);
    const response = await change(token, { password: COMMON.toUpperCase() });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatch(/too common/);
    expect(response.body.toLowerCase()).not.toContain(COMMON);
    expect(await passwordHash(user.userId)).toBe(before);
    expect((await getSession(token)).statusCode).toBe(200);
  });

  it('takes nothing but the new password from the body', async () => {
    const user = await addUser();
    const other = await addUser();
    const { token } = await signedIn(user);
    const response = await change(token, { password: NEW_PASSWORD, userId: other.userId });
    expect(response.statusCode).toBe(400);
  });

  it('revokes every other session and device cookie, and keeps this browser under a new id', async () => {
    const user = await addUser();
    const { token, device } = await signedIn(user);
    const other = await signedIn(user);
    const before = await passwordHash(user.userId);

    const response = await change(token, { password: NEW_PASSWORD }, device);
    expect(response.statusCode).toBe(204);
    const next = tokenOf(response);
    expect(next).not.toBe('');
    expect(next).not.toBe(token);
    expect((await getSession(token)).statusCode).toBe(401);
    expect((await getSession(other.token)).statusCode).toBe(401);
    expect((await getSession(next)).statusCode).toBe(200);

    const fresh = cookieNamed(response, DEVICE);
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(device);
    expect(
      await migrator<{ live: number }>(
        'SELECT count(*)::int AS live FROM auth.device WHERE user_id = $1 AND revoked_at IS NULL',
        [user.userId],
      ),
    ).toEqual([{ live: 1 }]);

    const after = await passwordHash(user.userId);
    expect(after).not.toBe(before);
    expect((await signIn(user)).statusCode).toBe(401);
    expect((await signIn(user, NEW_PASSWORD)).statusCode).toBe(200);

    const events = await migrator<{ code: string; reason: string | null; tenant_id: string }>(
      `SELECT code, reason, tenant_id FROM auth.audit_event
        WHERE user_id = $1 AND code IN ('password_changed', 'sessions_revoked') ORDER BY code`,
      [user.userId],
    );
    expect(events).toEqual([
      { code: 'password_changed', reason: null, tenant_id: tenant.id },
      { code: 'sessions_revoked', reason: 'password_changed', tenant_id: tenant.id },
    ]);
    const copies = await asMigratorIn(tenant.id, async (client) =>
      (
        await client.query<{ action: string }>(
          `SELECT action FROM app.audit_event
            WHERE entity_id IN (SELECT id FROM auth.audit_event WHERE user_id = $1)
            ORDER BY action`,
          [user.userId],
        )
      ).rows.map((row) => row.action),
    );
    expect(copies).toEqual(
      expect.arrayContaining(['platform.auth.password_changed', 'platform.auth.sessions_revoked']),
    );

    await vi.waitFor(() => {
      expect(sent.map((email) => email.to)).toContain(user.email);
    });
    const notice = sent.find((email) => email.to === user.email);
    expect(notice?.subject).toMatch(/password was changed/);
    expect(notice?.text).not.toMatch(/https?:/);

    const stored = await migrator<{ text: string }>(
      'SELECT a::text AS text FROM auth.audit_event AS a WHERE user_id = $1',
      [user.userId],
    );
    for (const secret of [NEW_PASSWORD, after, before]) {
      expect(stored.filter(({ text }) => text.includes(secret))).toEqual([]);
      expect(logs.text()).not.toContain(secret);
      expect(notice?.text).not.toContain(secret);
      for (const body of bodies) expect(body).not.toContain(secret);
    }
  });
});
