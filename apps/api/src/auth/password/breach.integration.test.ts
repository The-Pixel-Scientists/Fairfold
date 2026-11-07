// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The breached-password check against the test database (ADR 0010), with a
// local fake in place of the service: a new password found breached is
// refused and one with no answer is accepted with its check pending; the
// next password sign-in looks it up again, only once the password is
// verified; a breached password without a factor gets no session, in any
// tenant or app; with one, the session after MFA reaches only the password
// change, sign-out and the session read; and the operator's setting is
// recorded once each time it changes. No password or hash reaches a log.

import { createHash, randomBytes } from 'node:crypto';

import { createDatabase } from '@pixel-scientists/db';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connectionSettings,
  databaseSettings,
  withClient,
} from '../../../../../packages/db/test/connect.ts';
import {
  createTestTenant,
  testSlug,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { captureLogs } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { Secret } from '../../config.ts';
import { createLogger } from '../../logger.ts';
import { newToken } from '../cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from '../index.ts';
import { hashPassword } from '../passwords.ts';
import type { BreachAnswer } from './range.ts';
import { recordBreachCheckSetting } from './setting.ts';

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const PASSWORD = 'a long synthetic passphrase';
const NEW_PASSWORD = 'another long synthetic passphrase';
const SESSION = '__Host-tps_portal_session';

let app: FastifyInstance;
let auth: Auth;
let tenant: TestTenant;
let otherTenant: TestTenant;
const logs = captureLogs();
const bodies: string[] = [];
let answer: BreachAnswer = { answer: 'not_breached' };
const looked: string[] = [];

interface User {
  readonly email: string;
  readonly userId: string;
  readonly ip: string;
}

type Flag = 'pending' | 'breached' | 'none';

function send(
  method: 'GET' | 'POST',
  path: string,
  options: { payload?: object; token?: string; ip?: string; app?: 'console' | 'portal' } = {},
) {
  const host = new URL(ORIGINS[options.app ?? 'portal']).host;
  return app
    .inject({
      method,
      url: `/api${path}`,
      remoteAddress: options.ip ?? '192.0.2.1',
      ...(options.payload === undefined ? {} : { payload: options.payload }),
      headers: {
        host,
        ...(method === 'POST' ? { origin: ORIGINS[options.app ?? 'portal'] } : {}),
        ...(options.token === undefined ? {} : { cookie: `${SESSION}=${options.token}` }),
      },
    })
    .then((response) => {
      bodies.push(response.body);
      return response;
    });
}

function tokenOf(response: LightMyRequestResponse): string {
  const headers = [response.headers['set-cookie'] ?? []].flat();
  const pair = headers.find((header) => header.startsWith(`${SESSION}=`))?.split(';', 1)[0];
  return pair?.slice(SESSION.length + 1) ?? '';
}

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

async function addUser(flag: Flag, factor = false): Promise<User> {
  const email = `${testSlug()}@example.test`;
  const hash = await hashPassword(PASSWORD);
  const userId = await withClient('migrator', async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO auth."user" (email, email_verified) VALUES ($1, true) RETURNING id',
      [email],
    );
    const id = rows[0]?.id ?? '';
    await client.query(
      `INSERT INTO auth.account (user_id, account_id, provider_id, password,
                                 breach_check_pending_since, password_breached_at)
       VALUES ($1::uuid, $1::text, 'credential', $2,
               CASE WHEN $3 = 'pending' THEN now() END, CASE WHEN $3 = 'breached' THEN now() END)`,
      [id, hash, flag],
    );
    if (factor) {
      await client.query(
        'INSERT INTO auth.two_factor (user_id, secret, verified) VALUES ($1, $2, true)',
        [id, randomBytes(40).toString('hex')],
      );
    }
    return id;
  });
  return { email, userId, ip: `10.${[...randomBytes(3)].join('.')}` };
}

const signIn = (
  user: User,
  password = PASSWORD,
  into = tenant,
  app: 'console' | 'portal' = 'portal',
) =>
  send('POST', `/auth/tenants/${into.slug}/sign-in`, {
    payload: { email: user.email, password },
    ip: user.ip,
    app,
  });

async function flagsOf(user: User) {
  const [row] = await migrator<{ pending: boolean; breached: boolean }>(
    `SELECT breach_check_pending_since IS NOT NULL AS pending,
            password_breached_at IS NOT NULL AS breached
       FROM auth.account WHERE user_id = $1`,
    [user.userId],
  );
  return row;
}

const liveSessions = async (user: User) =>
  (
    await migrator<{ n: number }>(
      'SELECT count(*)::integer AS n FROM auth.session WHERE user_id = $1 AND revoked_at IS NULL',
      [user.userId],
    )
  )[0]?.n;

const logger = createLogger({ level: 'info', destination: logs.stream });

/** The auth module as main.ts creates it, with the operator's breach-check setting. */
function startAuth(breachCheck?: 'on' | 'off'): Auth {
  const api = connectionSettings('app_api');
  const settings = loadAuthSettings({
    TPS_DEV: '1',
    TPS_DB_HOST: api.host,
    TPS_AUTH_SECRET: newToken(),
    TPS_DB_APP_AUTH_PASSWORD: connectionSettings('app_auth').password,
    TPS_CONSOLE_ORIGIN: ORIGINS.console,
    TPS_PORTAL_ORIGIN: ORIGINS.portal,
    ...(breachCheck === undefined ? {} : { TPS_AUTH_BREACH_CHECK: breachCheck }),
  });
  return createAuth(settings, {
    database: {
      host: api.host,
      port: api.port,
      database: api.database,
      password: new Secret(api.password),
    },
    log: logger,
    commonPasswords: new Set(['synthetic common password']),
    lookUpPassword: (password) => {
      looked.push(password);
      return Promise.resolve(answer);
    },
  });
}

beforeAll(async () => {
  auth = startAuth();
  app = await buildApp({ logger, checkDatabase: () => Promise.resolve(), auth });
  tenant = await createTestTenant();
  otherTenant = await createTestTenant();
});

afterAll(async () => {
  await app.close();
  await auth.close();
  const text = logs.text() + bodies.join('\n');
  for (const password of [PASSWORD, NEW_PASSWORD]) {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    expect(text).not.toContain(password);
    expect(text).not.toContain(sha1.slice(0, 5));
    expect(text.toUpperCase()).not.toContain(sha1);
  }
});

describe('the breached-password check', { timeout: 120_000 }, () => {
  it('rechecks a pending password only once it is verified, and clears the flag on an answer', async () => {
    const user = await addUser('pending');
    answer = { answer: 'not_breached' };
    looked.length = 0;
    expect((await signIn(user, 'not the right passphrase')).statusCode).toBe(401);
    expect(looked).toEqual([]);

    answer = { answer: 'no_answer', code: 'timeout' };
    expect((await signIn(user)).statusCode).toBe(200);
    expect(await flagsOf(user)).toEqual({ pending: true, breached: false });
    expect(logs.text()).toContain('"breachCheck":"timeout"');

    answer = { answer: 'not_breached' };
    expect((await signIn(user)).statusCode).toBe(200);
    expect(await flagsOf(user)).toEqual({ pending: false, breached: false });
    expect(looked).toEqual([PASSWORD, PASSWORD]);
  });

  it('gives a password found breached, with no factor, no session in any tenant or app', async () => {
    const user = await addUser('pending');
    answer = { answer: 'breached' };
    const response = await signIn(user);
    expect(response.statusCode).toBe(403);
    expect(response.body).toMatch(/data breach/);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await flagsOf(user)).toEqual({ pending: false, breached: true });

    answer = { answer: 'not_breached' };
    const inConsole = await signIn(user, PASSWORD, otherTenant, 'console');
    expect(inConsole.statusCode).toBe(403);
    expect(inConsole.body).toMatch(/data breach/);
    expect(await liveSessions(user)).toBe(0);
  });

  it('lets a session that completed MFA reach only the password change and sign-out', async () => {
    const user = await addUser('breached', true);
    const started = await signIn(user);
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ mfa: 'verify' });
    await migrator(
      "UPDATE auth.session SET mfa_state = 'complete' WHERE user_id = $1 AND revoked_at IS NULL",
      [user.userId],
    );
    const token = tokenOf(started);

    const read = await send('GET', '/auth/session', { token });
    expect(read.statusCode).toBe(403);
    expect(read.body).toMatch(/change it before you continue/);
    const switched = await send('POST', '/auth/switch-tenant', {
      token,
      payload: { membershipId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(switched.statusCode).toBe(401);
    const email = await send('POST', '/auth/account/email', {
      token,
      payload: { email: `${testSlug()}@example.test` },
    });
    expect(email.statusCode).toBe(401);

    // The breached password itself, even with no answer from the service, is refused.
    answer = { answer: 'no_answer', code: 'connect' };
    const again = await send('POST', '/auth/account/password', {
      token,
      payload: { password: PASSWORD },
    });
    expect(again.statusCode).toBe(400);
    expect(again.body).toMatch(/appeared in a data breach/);

    answer = { answer: 'breached' };
    const breached = await send('POST', '/auth/account/password', {
      token,
      payload: { password: NEW_PASSWORD },
    });
    expect(breached.statusCode).toBe(400);
    expect(await flagsOf(user)).toEqual({ pending: false, breached: true });

    answer = { answer: 'not_breached' };
    const changed = await send('POST', '/auth/account/password', {
      token,
      payload: { password: NEW_PASSWORD },
    });
    expect(changed.statusCode).toBe(204);
    expect(await flagsOf(user)).toEqual({ pending: false, breached: false });
    expect((await send('GET', '/auth/session', { token: tokenOf(changed) })).statusCode).toBe(200);
  });

  it('sets the check pending when a new password gets no answer', async () => {
    const user = await addUser('none', true);
    const started = await signIn(user);
    await migrator(
      "UPDATE auth.session SET mfa_state = 'complete' WHERE user_id = $1 AND revoked_at IS NULL",
      [user.userId],
    );
    answer = { answer: 'no_answer', code: 'timeout' };
    const changed = await send('POST', '/auth/account/password', {
      token: tokenOf(started),
      payload: { password: NEW_PASSWORD, breachCheckPending: false },
    });
    expect(changed.statusCode).toBe(400);
    const accepted = await send('POST', '/auth/account/password', {
      token: tokenOf(started),
      payload: { password: NEW_PASSWORD },
    });
    expect(accepted.statusCode).toBe(204);
    expect(await flagsOf(user)).toEqual({ pending: true, breached: false });
  });

  it('records the setting once each time it changes', async () => {
    const db = createDatabase<unknown>(databaseSettings('app_auth', 1));
    const count = async () =>
      (
        await migrator<{ n: number }>(
          "SELECT count(*)::integer AS n FROM auth.audit_event WHERE code = 'password_check_setting_changed'",
        )
      )[0]?.n ?? 0;
    try {
      const [last] = await migrator<{ reason: string }>(
        `SELECT reason FROM auth.audit_event WHERE code = 'password_check_setting_changed'
          ORDER BY occurred_at DESC LIMIT 1`,
      );
      const on = (last?.reason ?? 'on') === 'on';
      const before = await count();
      expect(await recordBreachCheckSetting(db, on)).toBe(false);
      expect(await recordBreachCheckSetting(db, !on)).toBe(true);
      expect(await recordBreachCheckSetting(db, !on)).toBe(false);
      expect(await count()).toBe(before + 1);
      expect(await recordBreachCheckSetting(db, on)).toBe(true);
      const [event] = await migrator<Record<string, unknown>>(
        `SELECT reason, user_id, tenant_id, identifier, ip_address FROM auth.audit_event
          WHERE code = 'password_check_setting_changed' ORDER BY occurred_at DESC LIMIT 1`,
      );
      expect(event).toEqual({
        reason: on ? 'on' : 'off',
        user_id: null,
        tenant_id: null,
        identifier: null,
        ip_address: null,
      });
    } finally {
      await db.destroy();
    }
  });

  it('records a changed setting once across boots of the auth module', async () => {
    const [last] = await migrator<{ reason: string }>(
      `SELECT reason FROM auth.audit_event WHERE code = 'password_check_setting_changed'
        ORDER BY occurred_at DESC LIMIT 1`,
    );
    const current = last?.reason === 'off' ? 'off' : 'on';
    const other = current === 'on' ? 'off' : 'on';
    const count = async () =>
      (
        await migrator<{ n: number }>(
          "SELECT count(*)::integer AS n FROM auth.audit_event WHERE code = 'password_check_setting_changed'",
        )
      )[0]?.n ?? 0;
    // Each boot creates the auth module from the environment and records the setting, as main.ts does.
    const boot = async (value: 'on' | 'off') => {
      const booted = startAuth(value);
      try {
        return await booted.recordBreachCheckSetting();
      } finally {
        await booted.close();
      }
    };
    const before = await count();
    expect(await boot(current)).toBe(false);
    expect(await boot(current)).toBe(false);
    expect(await count()).toBe(before);
    expect(await boot(other)).toBe(true);
    expect(await boot(other)).toBe(false);
    expect(await count()).toBe(before + 1);
    expect(await boot(current)).toBe(true);
    expect(await count()).toBe(before + 2);
  });
});
