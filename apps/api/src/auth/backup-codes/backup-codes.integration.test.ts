// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Backup codes against the test database (ADR 0010): made only after
// step-up beside a confirmed authenticator and shown once, kept only as
// HMACs, each used once even by requests sent together, failures counted
// with the authenticator's on the pending session, removed with the last
// factor, and recorded, copied and emailed with no code anywhere else.

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
import type { Email, Sender } from '../../email/sender.ts';
import { createLogger } from '../../logger.ts';
import { newToken } from '../cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from '../index.ts';
import { hashPassword } from '../passwords.ts';
import { codeAt, stepAt } from '../totp.ts';

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const HOSTS = { console: 'console.example.org', portal: 'apply.example.org' } as const;
type AppName = keyof typeof HOSTS;
const PASSWORD = 'a long synthetic passphrase';

let app: FastifyInstance;
let auth: Auth;
let tenantA: TestTenant;
const logs = captureLogs();
const sent: Email[] = [];
const sender: Sender = {
  send(email) {
    sent.push(email);
    return Promise.resolve({ sent: true });
  },
};
const bodies: string[] = [];
/** Every code any test was shown. */
const shown: string[] = [];

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

const tokenOf = (response: LightMyRequestResponse, target: AppName = 'console') =>
  new RegExp(`__Host-tps_${target}_session=([^;]*);`).exec(
    String(response.headers['set-cookie']),
  )?.[1];

/** Make codes from `token`'s session: the response, with the codes added to `shown`. */
async function generate(token: string, target: AppName = 'console') {
  const response = await call('POST', '/auth/backup-codes', token, undefined, target);
  if (response.statusCode === 200) shown.push(...response.json<{ codes: string[] }>().codes);
  return response;
}

const codesOf = (response: LightMyRequestResponse) => response.json<{ codes: string[] }>().codes;

const count = (token: string, target: AppName = 'console') =>
  call('GET', '/auth/backup-codes', token, undefined, target);

const verify = (pending: string, user: User, code: string) =>
  call('POST', '/auth/backup-codes/verify', pending, { code }, 'console', user.ip);

const newAddress = () => `10.${[...randomBytes(3)].join('.')}`;

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
  return { email, userId, ip: newAddress() };
}

async function signIn(user: User, target: AppName = 'console') {
  const response = await call(
    'POST',
    `/auth/tenants/${tenantA.slug}/sign-in`,
    undefined,
    { email: user.email, password: PASSWORD },
    target,
    user.ip,
  );
  expect(response.statusCode).toBe(200);
  return tokenOf(response, target) ?? '';
}

/** A complete console session for a new member of staff, who has set up an authenticator. */
async function signedIn() {
  const user = await addUser([tenantA]);
  const pending = await signIn(user);
  const key = (await call('POST', '/auth/totp/enrol', pending)).json<{ key: string }>().key;
  const confirmed = await call(
    'POST',
    '/auth/totp/confirm',
    pending,
    { code: codeAt(fromBase32(key), (await freshStep()) - 1) },
    'console',
    user.ip,
  );
  expect(confirmed.statusCode).toBe(200);
  return { user, token: tokenOf(confirmed) ?? '' };
}

const storedCodes = (userId: string) =>
  migrator<{ backup_codes: string | null }>(
    'SELECT backup_codes FROM auth.two_factor WHERE user_id = $1',
    [userId],
  ).then((rows) => rows[0]?.backup_codes);

const events = (userId: string) =>
  migrator<{ code: string }>(
    `SELECT code FROM auth.audit_event WHERE user_id = $1
      AND code IN ('backup_code_used', 'backup_codes_regenerated', 'mfa_code_failed',
                   'pending_session_discarded')
      ORDER BY occurred_at, code`,
    [userId],
  ).then((rows) => rows.map((row) => row.code));

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
  tenantA = await createTestTenant();
});

afterAll(async () => {
  await app.close();
  await auth.close();
});

describe('making backup codes', { timeout: 120_000 }, () => {
  it('needs a complete session that re-authenticated within 5 minutes, and an authenticator', async () => {
    const pending = await signIn(await addUser([tenantA]));
    expect((await generate(pending)).statusCode).toBe(401);

    const { user, token } = await signedIn();
    const now = Date.now();
    await migrator(
      'UPDATE auth.session SET reauthenticated_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [user.userId, new Date(now)],
    );
    vi.useFakeTimers({ toFake: ['Date'], now: now + 5 * 60_000 + 1000 });
    try {
      expect((await generate(token)).statusCode).toBe(403);
    } finally {
      vi.useRealTimers();
    }
    expect(await storedCodes(user.userId)).toBeNull();

    // An applicant with no authenticator has a complete portal session.
    const applicant = await addUser([]);
    const portal = await signIn(applicant, 'portal');
    const refused = await generate(portal, 'portal');
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ detail: string }>().detail).toMatch(/authenticator app/);
  });

  it('shows 10 codes once, keeps only their HMACs, and replaces every earlier code', async () => {
    const { user, token } = await signedIn();
    sent.length = 0;
    const first = codesOf(await generate(token));
    expect(first).toHaveLength(10);
    expect(new Set(first).size).toBe(10);
    expect((await count(token)).json()).toEqual({ remaining: 10 });

    const second = codesOf(await generate(token));
    expect(second.filter((code) => first.includes(code))).toEqual([]);
    expect((await verify(await signIn(user), user, first[0] ?? '')).statusCode).toBe(401);
    expect((await count(token)).json()).toEqual({ remaining: 10 });

    await vi.waitFor(() => {
      expect(sent.filter((email) => email.to === user.email)).toHaveLength(2);
    });
    expect(sent[0]?.subject).toMatch(/New backup codes were made/);
    expect(await events(user.userId)).toEqual([
      'backup_codes_regenerated',
      'backup_codes_regenerated',
      'mfa_code_failed',
    ]);
  });

  it('refuses a portal session that has not proven the account’s authenticator', async () => {
    const { user } = await signedIn();
    // Portal sign-in waits for the factor too, so the policy refuses it first.
    const portal = await signIn(user, 'portal');
    expect((await generate(portal, 'portal')).statusCode).toBe(401);
    expect(await storedCodes(user.userId)).toBeNull();
  });
});

describe('signing in with a backup code', { timeout: 120_000 }, () => {
  it('completes the sign-in once, removes the code, and says how many are left', async () => {
    const { user, token } = await signedIn();
    const [code = '', other = ''] = codesOf(await generate(token));
    sent.length = 0;

    const pending = await signIn(user);
    // Case, spaces and the hyphen's place do not matter; the code still works once.
    const response = await verify(pending, user, ` ${code.toUpperCase()} `);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ mfa: string }>().mfa).toBe('complete');
    const signedInToken = tokenOf(response) ?? '';
    expect(signedInToken).not.toBe(pending);
    expect((await count(signedInToken)).json()).toEqual({ remaining: 9 });

    const used = await verify(await signIn(user), user, code);
    const wrong = await verify(await signIn(user), user, 'zzzzz-zzzzz');
    const shape = (r: LightMyRequestResponse) => ({
      ...r.json<Record<string, unknown>>(),
      requestId: undefined,
      status: r.statusCode,
    });
    expect(shape(used)).toEqual(shape(wrong));
    expect(used.statusCode).toBe(401);

    // A code from one account does nothing for another.
    const { user: someone } = await signedIn();
    expect((await verify(await signIn(someone), someone, other)).statusCode).toBe(401);

    await vi.waitFor(() => {
      expect(sent.map((email) => email.subject)).toContainEqual(
        expect.stringMatching(/A backup code was used/),
      );
    });
    const notice = sent.find((email) => email.subject.startsWith('A backup code was used'));
    expect(notice?.text).toMatch(/You have 9 backup codes left/);
    expect(await events(user.userId)).toEqual(
      expect.arrayContaining(['backup_code_used', 'mfa_code_failed']),
    );
    const copies = await asMigratorIn(tenantA.id, async (client) =>
      (
        await client.query<{ action: string }>(
          `SELECT action FROM app.audit_event
            WHERE entity_id IN (SELECT id FROM auth.audit_event WHERE user_id = $1)`,
          [user.userId],
        )
      ).rows.map((row) => row.action),
    );
    expect(copies).toEqual(
      expect.arrayContaining([
        'platform.auth.backup_codes_regenerated',
        'platform.auth.backup_code_used',
      ]),
    );
  });

  it('does not count as a step-up, though the password was just checked', async () => {
    const { user, token } = await signedIn();
    const [code = ''] = codesOf(await generate(token));
    const response = await verify(await signIn(user), user, code);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ recentAuthUntil: string | null }>().recentAuthUntil).toBeNull();

    const signedInToken = tokenOf(response) ?? '';
    const refusals = [
      await generate(signedInToken),
      await call('POST', '/auth/account/totp/start', signedInToken),
    ];
    // The step-up refusal; its reason, step_up, goes only to the log.
    for (const refused of refusals) {
      expect(refused.statusCode).toBe(403);
      expect(refused.json<{ detail: string }>().detail).toBe(
        'Confirm it is you again, then try again.',
      );
    }
    expect((await count(signedInToken)).json()).toEqual({ remaining: 9 });
  });

  it('accepts a code once when two sign-ins send it together', async () => {
    const { user, token } = await signedIn();
    const [code = ''] = codesOf(await generate(token));
    const [one, two] = await Promise.all([signIn(user), signIn(user)]);
    const statuses = (await Promise.all([verify(one, user, code), verify(two, user, code)])).map(
      (response) => response.statusCode,
    );
    expect(statuses.sort()).toEqual([200, 401]);
    expect((await count(token)).json()).toEqual({ remaining: 9 });
  });

  it('counts a wrong code with wrong authenticator codes, and discards the session at the fifth', async () => {
    const { user, token } = await signedIn();
    const [code = ''] = codesOf(await generate(token));
    const pending = await signIn(user);
    // Each from its own address, so no client delay starts first.
    const statuses = [];
    for (const wrong of ['000000', '000000', 'zzzzz-zzzzz', 'yyyyy-yyyyy', 'xxxxx-xxxxx']) {
      const path = wrong.includes('-') ? '/auth/backup-codes/verify' : '/auth/totp/verify';
      const response = await call('POST', path, pending, { code: wrong }, 'console', newAddress());
      statuses.push(response.statusCode);
      if (statuses.length === 5) {
        expect(String(response.headers['set-cookie'])).toMatch(/__Host-tps_console_session=;/);
      }
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    expect((await verify(pending, user, code)).statusCode).toBe(401);
    expect(await events(user.userId)).toContain('pending_session_discarded');
    expect((await count(token)).json()).toEqual({ remaining: 10 });
  });

  it('counts each wrong code towards the sign-in delay, and checks none while it runs', async () => {
    const { user, token } = await signedIn();
    const [code = ''] = codesOf(await generate(token));
    const pending = await signIn(user);
    // The sign-in and 4 wrong codes reach the client's limit of 5.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await verify(pending, user, 'zzzzz-zzzzz')).statusCode).toBe(401);
    }
    const refused = await verify(pending, user, code);
    expect(refused.statusCode).toBe(429);
    expect((await count(token)).json()).toEqual({ remaining: 10 });
  });

  it('takes nothing but the code from the body, and refuses a session not waiting for one', async () => {
    const { user, token } = await signedIn();
    const [code = ''] = codesOf(await generate(token));
    const pending = await signIn(user);
    const named = await call(
      'POST',
      '/auth/backup-codes/verify',
      pending,
      { code, userId: user.userId },
      'console',
      user.ip,
    );
    expect(named.statusCode).toBe(400);
    expect((await verify(token, user, code)).statusCode).toBe(403);
    expect((await count(token)).json()).toEqual({ remaining: 10 });
  });
});

describe('removing the last authenticator', { timeout: 120_000 }, () => {
  it('removes the backup codes with it', async () => {
    const user = await addUser([]);
    const enrolled = await signIn(user, 'portal');
    // Applicant enrolment is S11-83's; give the account a factor and prove it.
    await withClient('app_auth', async (client) => {
      await client.query(
        'INSERT INTO auth.two_factor (user_id, secret, verified) VALUES ($1, $2, true)',
        [user.userId, 'ab'.repeat(60)],
      );
      await client.query('UPDATE auth."user" SET two_factor_enabled = true WHERE id = $1', [
        user.userId,
      ]);
    });
    await migrator(
      `UPDATE auth.session SET mfa_state = 'complete'
        WHERE user_id = $1 AND app = 'portal' AND revoked_at IS NULL`,
      [user.userId],
    );
    expect((await generate(enrolled, 'portal')).statusCode).toBe(200);
    expect(await storedCodes(user.userId)).not.toBeNull();
    expect(
      (await call('DELETE', '/auth/account/totp', enrolled, undefined, 'portal')).statusCode,
    ).toBe(204);
    expect(await storedCodes(user.userId)).toBeNull();
  });
});

describe('a code', { timeout: 120_000 }, () => {
  it('is in no auth table, response, event, email or log line but the one that showed it', async () => {
    expect(shown.length).toBeGreaterThan(0);
    const forms = shown.flatMap((code) => [code, code.replace('-', ''), code.toUpperCase()]);
    const tables = await migrator<{ text: string }>(
      `SELECT string_agg(t::text, ' ') AS text FROM (
         SELECT row_to_json(r)::text AS t FROM auth."user" r UNION ALL
         SELECT row_to_json(r)::text FROM auth.session r UNION ALL
         SELECT row_to_json(r)::text FROM auth.account r UNION ALL
         SELECT row_to_json(r)::text FROM auth.verification r UNION ALL
         SELECT row_to_json(r)::text FROM auth.two_factor r UNION ALL
         SELECT row_to_json(r)::text FROM auth.rate_limit r UNION ALL
         SELECT row_to_json(r)::text FROM auth.device r UNION ALL
         SELECT row_to_json(r)::text FROM auth.audit_event r
       ) rows (t)`,
    );
    const answers = bodies.filter((body) => !body.startsWith('{"codes":'));
    const text = [
      tables[0]?.text ?? '',
      ...answers,
      logs.text(),
      ...sent.map((email) => `${email.subject} ${email.text}`),
    ].join('\n');
    for (const form of forms) expect(text).not.toContain(form);
  });
});
