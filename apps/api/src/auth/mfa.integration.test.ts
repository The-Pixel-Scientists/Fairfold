// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Setting up an authenticator and completing a console sign-in with it,
// against the test database (ADR 0010): codes that work once, even when sent
// at the same moment, the 5-failure discard, the sign-in delay, the 10-minute
// wait, new session ids, the notice email, and no secret or code in clear in
// a table or log. Codes come from the key as an authenticator app reads it.
// Each test signs in from its own address, so counters never meet.

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectionSettings, withClient } from '../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  testSlug,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { captureLogs } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { Secret } from '../config.ts';
import type { Email, Sender } from '../email/sender.ts';
import { createLogger } from '../logger.ts';
import { hashToken, newToken } from './cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from './index.ts';
import { hashPassword } from './passwords.ts';
import { codeAt, stepAt } from './totp.ts';

const ORIGIN = 'https://console.example.org';
const HOST = 'console.example.org';
const PASSWORD = 'a long synthetic passphrase';

let app: FastifyInstance;
let auth: Auth;
const logs = captureLogs();
const sent: Email[] = [];
const sender: Sender = {
  send(email) {
    sent.push(email);
    return Promise.resolve({ sent: true });
  },
};

const newAddress = () => `10.${[...randomBytes(3)].join('.')}`;

function post(path: string, token?: string, payload?: object, ip = '192.0.2.1') {
  return app.inject({
    method: 'POST',
    url: `/api${path}`,
    remoteAddress: ip,
    headers: {
      host: HOST,
      origin: ORIGIN,
      ...(token === undefined ? {} : { cookie: `__Host-tps_console_session=${token}` }),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

const tokenOf = (response: LightMyRequestResponse) =>
  /^__Host-tps_console_session=([^;]*);/.exec(String(response.headers['set-cookie']))?.[1];

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

/** RFC 4648 base32, as an authenticator app reads the key. */
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

interface Staff {
  readonly email: string;
  readonly userId: string;
  readonly ip: string;
}

/** A new account with a password and a staff membership in `tenant`. */
async function addStaff(tenant: TestTenant): Promise<Staff> {
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
  await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', {
      tenant_id: tenant.id,
      user_id: userId,
      roles: ['tenant_admin'],
    }),
  );
  return { email, userId, ip: newAddress() };
}

async function signIn(tenant: TestTenant, staff: Staff): Promise<string> {
  const response = await post(
    `/auth/tenants/${tenant.slug}/sign-in`,
    undefined,
    { email: staff.email, password: PASSWORD },
    staff.ip,
  );
  expect(response.statusCode).toBe(200);
  return tokenOf(response) ?? '';
}

/** Sign in, set up an authenticator, and return its secret and the session waiting to confirm it. */
async function enrol(tenant: TestTenant, staff: Staff) {
  const token = await signIn(tenant, staff);
  const response = await post('/auth/totp/enrol', token);
  expect(response.statusCode).toBe(200);
  const { key, uri } = response.json<{ key: string; uri: string }>();
  return { token, key, uri, secret: fromBase32(key) };
}

const codeFor = (secret: Buffer, step: number) => codeAt(secret, step);

async function events(userId: string): Promise<string[]> {
  const rows = await migrator<{ code: string }>(
    'SELECT code FROM auth.audit_event WHERE user_id = $1 ORDER BY occurred_at, code',
    [userId],
  );
  return rows.map(({ code }) => code);
}

beforeAll(async () => {
  const api = connectionSettings('app_api');
  const appAuth = connectionSettings('app_auth');
  const settings = loadAuthSettings({
    TPS_DEV: '1',
    TPS_DB_HOST: api.host,
    TPS_AUTH_SECRET: newToken(),
    TPS_DB_APP_AUTH_PASSWORD: appAuth.password,
    TPS_CONSOLE_ORIGIN: ORIGIN,
    TPS_PORTAL_ORIGIN: 'https://apply.example.org',
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
});

afterAll(async () => {
  await app.close();
  await auth.close();
});

describe('setting up an authenticator', { timeout: 60_000 }, () => {
  let tenant: TestTenant;
  beforeAll(async () => {
    tenant = await createTestTenant();
  });

  it('gives a key and an otpauth URI for the account, and replaces a secret not yet confirmed', async () => {
    const staff = await addStaff(tenant);
    const first = await enrol(tenant, staff);
    expect(first.key).toMatch(/^[A-Z2-7]{52}$/);
    expect(first.uri).toContain(`:${encodeURIComponent(staff.email)}?secret=${first.key}&`);
    const again = await post('/auth/totp/enrol', first.token);
    const second = again.json<{ key: string }>().key;
    expect(second).not.toBe(first.key);

    const step = await freshStep();
    const old = await post('/auth/totp/confirm', first.token, {
      code: codeFor(first.secret, step),
    });
    expect(old.statusCode).toBe(401);
    const right = codeFor(fromBase32(second), step);
    expect((await post('/auth/totp/confirm', first.token, { code: right })).statusCode).toBe(200);
  });

  it('confirms with a code: MFA enrolled, the session complete under a new id, and a notice sent', async () => {
    const staff = await addStaff(tenant);
    const { token, secret } = await enrol(tenant, staff);
    const step = await freshStep();
    const response = await post('/auth/totp/confirm', token, { code: codeFor(secret, step) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mfa: 'complete',
      activeMembership: { roles: ['tenant_admin'] },
    });
    const next = tokenOf(response) ?? '';
    expect(next).not.toBe(token);

    const sessions = await migrator<{ token_hash: Buffer; mfa_state: string; revoked: boolean }>(
      `SELECT token_hash, mfa_state, revoked_at IS NOT NULL AS revoked
         FROM auth.session WHERE user_id = $1 ORDER BY created_at`,
      [staff.userId],
    );
    expect(sessions).toEqual([
      { token_hash: hashToken(token), mfa_state: 'enrol', revoked: true },
      { token_hash: hashToken(next), mfa_state: 'complete', revoked: false },
    ]);
    const [user] = await migrator<{ two_factor_enabled: boolean }>(
      'SELECT two_factor_enabled FROM auth."user" WHERE id = $1',
      [staff.userId],
    );
    expect(user?.two_factor_enabled).toBe(true);
    expect(await events(staff.userId)).toContain('mfa_enrolled');
    await vi.waitFor(() => {
      expect(sent.find((email) => email.to === staff.email)?.subject).toMatch(
        /^An authenticator app was added to your /,
      );
    });
    // Enrolment is over: a new sign-in waits for a code, and the TOTP routes refuse a complete session.
    expect((await post('/auth/totp/enrol', next)).statusCode).toBe(403);
    const later = await signIn(tenant, staff);
    expect((await post('/auth/totp/enrol', later)).statusCode).toBe(403);
  });
});

describe('codes', { timeout: 60_000 }, () => {
  let tenant: TestTenant;
  beforeAll(async () => {
    tenant = await createTestTenant();
  });

  it('work once: a code accepted at enrolment or sign-in is refused at the next sign-in', async () => {
    const staff = await addStaff(tenant);
    const { token, secret } = await enrol(tenant, staff);
    const step = await freshStep();
    expect(
      (await post('/auth/totp/confirm', token, { code: codeFor(secret, step - 1) })).statusCode,
    ).toBe(200);

    const second = await signIn(tenant, staff);
    expect(
      (await post('/auth/totp/verify', second, { code: codeFor(secret, step - 1) })).statusCode,
    ).toBe(401);
    const verified = await post('/auth/totp/verify', second, { code: codeFor(secret, step) });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ mfa: 'complete' });
    expect(tokenOf(verified)).not.toBe(second);

    const third = await signIn(tenant, staff);
    expect(
      (await post('/auth/totp/verify', third, { code: codeFor(secret, step) })).statusCode,
    ).toBe(401);
    // An earlier step than the last one accepted is refused too.
    expect(
      (await post('/auth/totp/verify', third, { code: codeFor(secret, step - 1) })).statusCode,
    ).toBe(401);
    expect(
      (await post('/auth/totp/verify', third, { code: codeFor(secret, step + 1) })).statusCode,
    ).toBe(200);
  });

  it('refuse a code more than one step away', async () => {
    const staff = await addStaff(tenant);
    const { token, secret } = await enrol(tenant, staff);
    const step = await freshStep();
    for (const wrong of [step - 2, step + 3]) {
      expect(
        (await post('/auth/totp/confirm', token, { code: codeFor(secret, wrong) })).statusCode,
      ).toBe(401);
    }
    expect(
      (await post('/auth/totp/confirm', token, { code: codeFor(secret, step) })).statusCode,
    ).toBe(200);
  });

  it('accept one code sent in two sign-ins at the same moment only once', async () => {
    const staff = await addStaff(tenant);
    const { token, secret } = await enrol(tenant, staff);
    const step = await freshStep();
    expect(
      (await post('/auth/totp/confirm', token, { code: codeFor(secret, step - 1) })).statusCode,
    ).toBe(200);
    const sessions = [await signIn(tenant, staff), await signIn(tenant, staff)];
    const code = codeFor(secret, step);
    const statuses = (
      await Promise.all(sessions.map((pending) => post('/auth/totp/verify', pending, { code })))
    ).map((response) => response.statusCode);
    expect(statuses.sort()).toEqual([200, 401]);
  });

  it('confirm once when one session sends the same code twice at once', async () => {
    const staff = await addStaff(tenant);
    const { token, secret } = await enrol(tenant, staff);
    const code = codeFor(secret, await freshStep());
    const statuses = (
      await Promise.all([1, 2].map(() => post('/auth/totp/confirm', token, { code })))
    ).map((response) => response.statusCode);
    expect(statuses.sort()).toEqual([200, 401]);
  });
});

describe('a session waiting for a code', { timeout: 60_000 }, () => {
  let tenant: TestTenant;
  beforeAll(async () => {
    tenant = await createTestTenant();
  });

  /** A staff member whose authenticator is set up, and its secret. */
  async function enrolled() {
    const staff = await addStaff(tenant);
    const { token, secret } = await enrol(tenant, staff);
    const step = await freshStep();
    const code = codeFor(secret, step - 1);
    expect((await post('/auth/totp/confirm', token, { code }, staff.ip)).statusCode).toBe(200);
    return { staff, secret };
  }

  const wrongCode = (secret: Buffer, step: number) =>
    String((Number(codeFor(secret, step)) + 1) % 1_000_000).padStart(6, '0');

  /** The sign-in count of the staff member's identifier and address. */
  async function charges(staff: Staff): Promise<number> {
    const [row] = await migrator<{ count: number }>(
      `SELECT count FROM auth.rate_limit
        WHERE scope = 'sign_in_identifier_ip' AND identifier = $1 AND client_ip = $2::cidr`,
      [staff.email, `${staff.ip}/32`],
    );
    return row?.count ?? 0;
  }

  it('gives back the sign-in’s charge only when MFA completes', async () => {
    const { staff, secret } = await enrolled();
    expect(await charges(staff)).toBe(0);
    const pending = await signIn(tenant, staff);
    expect(await charges(staff)).toBe(1);
    const code = codeFor(secret, await freshStep());
    expect((await post('/auth/totp/verify', pending, { code }, staff.ip)).statusCode).toBe(200);
    expect(await charges(staff)).toBe(0);
  });

  it('gives each charge back to the address it was charged to', async () => {
    const { staff, secret } = await enrolled();
    const other = newAddress();
    // Another account's failed sign-in leaves a charge on the second address.
    const stranger = { email: `${testSlug()}@example.test`, password: PASSWORD };
    const failed = await post(`/auth/tenants/${tenant.slug}/sign-in`, undefined, stranger, other);
    expect(failed.statusCode).toBe(401);

    const counters = async () => {
      const rows = await migrator<{ scope: string; ip: string | null; count: number }>(
        `SELECT scope, host(client_ip) AS ip, count FROM auth.rate_limit
          WHERE (identifier = $1 OR identifier IS NULL)
            AND (client_ip IS NULL OR client_ip IN ($2::cidr, $3::cidr))`,
        [staff.email, `${staff.ip}/32`, `${other}/32`],
      );
      return Object.fromEntries(rows.map((row) => [`${row.scope} ${row.ip}`, row.count]));
    };
    const before = await counters();
    expect(before[`sign_in_ip ${other}`]).toBe(1);

    const pending = await signIn(tenant, staff);
    const code = codeFor(secret, await freshStep());
    expect((await post('/auth/totp/verify', pending, { code }, other)).statusCode).toBe(200);
    expect(await counters()).toEqual(before);
  });

  it('is discarded at the fifth wrong code, each recorded', async () => {
    const { staff, secret } = await enrolled();
    const before = (await events(staff.userId)).length;
    const pending = await signIn(tenant, staff);
    const step = await freshStep();
    const statuses = [];
    // Each from its own address, so no client delay starts first.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = wrongCode(secret, step);
      const response = await post('/auth/totp/verify', pending, { code }, newAddress());
      statuses.push(response.statusCode);
      if (attempt === 4) expect(String(response.headers['set-cookie'])).toMatch(/Max-Age=0/);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    // Discarded: even the right code is too late.
    expect(
      (await post('/auth/totp/verify', pending, { code: codeFor(secret, step) })).statusCode,
    ).toBe(401);
    const recorded = (await events(staff.userId)).slice(before);
    expect(recorded.filter((code) => code === 'mfa_code_failed')).toHaveLength(5);
    expect(recorded).toContain('pending_session_discarded');
  });

  it('counts each code towards the sign-in delay, and checks none while it runs', async () => {
    const { staff, secret } = await enrolled();
    const pending = await signIn(tenant, staff);
    const step = await freshStep();
    const wrong = wrongCode(secret, step);
    // The sign-in and 4 wrong codes reach the client's limit of 5.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await post('/auth/totp/verify', pending, { code: wrong }, staff.ip)).statusCode).toBe(
        401,
      );
    }
    expect(await events(staff.userId)).toContain('rate_limit_reached');
    // A fifth from elsewhere discards the session.
    expect(
      (await post('/auth/totp/verify', pending, { code: wrong }, newAddress())).statusCode,
    ).toBe(401);
    const signInPath = `/auth/tenants/${tenant.slug}/sign-in`;
    const credentials = { email: staff.email, password: PASSWORD };
    expect((await post(signInPath, undefined, credentials, staff.ip)).statusCode).toBe(429);

    // A new pending session, from an address with no delay, gets no code checked from this client.
    const next = await signIn(tenant, { ...staff, ip: newAddress() });
    const right = codeFor(secret, step);
    const refused = await post('/auth/totp/verify', next, { code: right }, staff.ip);
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    const [waiting] = await migrator<{ mfa_state: string; mfa_failures: number }>(
      'SELECT mfa_state, mfa_failures FROM auth.session WHERE token_hash = $1',
      [hashToken(next)],
    );
    expect(waiting).toEqual({ mfa_state: 'verify', mfa_failures: 0 });

    // When the delay ends, the right password does not clear it: the next delay doubles.
    await migrator(
      `UPDATE auth.rate_limit SET blocked_until = now() - interval '1 second'
        WHERE scope = 'sign_in_identifier_ip' AND identifier = $1`,
      [staff.email],
    );
    const again = await signIn(tenant, staff);
    const doubled = await post('/auth/totp/verify', again, { code: right }, staff.ip);
    expect(doubled.statusCode).toBe(429);
    expect(Number(doubled.headers['retry-after'])).toBeGreaterThan(55);

    // The refused code was never checked, so it still completes the session from elsewhere.
    expect((await post('/auth/totp/verify', next, { code: right }, newAddress())).statusCode).toBe(
      200,
    );
  });

  it('is dead after 10 minutes, and reaches only the MFA routes until then', async () => {
    const other = await addStaff(tenant);
    const pending = await signIn(tenant, other);
    expect(
      (await post('/auth/switch-tenant', pending, { membershipId: other.userId })).statusCode,
    ).toBe(401);
    expect(
      (await post('/auth/step-up', pending, { password: PASSWORD, code: '000000' })).statusCode,
    ).toBe(401);
    await migrator(
      `UPDATE auth.session SET created_at = now() - interval '10 minutes 1 second',
              last_seen_at = now() - interval '10 minutes 1 second' WHERE token_hash = $1`,
      [hashToken(pending)],
    );
    expect((await post('/auth/totp/enrol', pending)).statusCode).toBe(401);
  });
});

describe('secrets and codes', { timeout: 60_000 }, () => {
  it('are never in clear in an auth table or a log line', async () => {
    const tenant = await createTestTenant();
    const staff = await addStaff(tenant);
    const { token, key, secret } = await enrol(tenant, staff);
    const step = await freshStep();
    const codes = [codeFor(secret, step - 1), codeFor(secret, step)];
    await post('/auth/totp/confirm', token, { code: codes[0] });
    const pending = await signIn(tenant, staff);
    await post('/auth/totp/verify', pending, { code: codes[1] });

    // Every text column of every auth table, for the key and the secret.
    const columns = await migrator<{ name: string; column: string }>(
      `SELECT format('%I.%I', table_schema, table_name) AS name, quote_ident(column_name) AS column
         FROM information_schema.columns
        WHERE table_schema = 'auth' AND data_type IN ('text', 'character varying')`,
    );
    const stored: string[] = [];
    for (const { name, column } of columns) {
      const rows = await migrator<{ value: string | null }>(
        `SELECT ${column} AS value FROM ${name}`,
      );
      stored.push(...rows.map(({ value }) => value ?? ''));
    }
    const raw = secret.toString('utf8');
    for (const value of [key, raw]) expect(stored.join('\n').includes(value)).toBe(false);
    // The user's own text values for the codes, which are short enough to turn up by chance in others.
    const own = await migrator<{ value: string | null }>(
      `SELECT concat_ws(' ', reason, identifier) AS value FROM auth.audit_event WHERE user_id = $1
       UNION ALL SELECT secret FROM auth.two_factor WHERE user_id = $1
       UNION ALL SELECT user_agent FROM auth.session WHERE user_id = $1`,
      [staff.userId],
    );
    const ownText = own.map(({ value }) => value ?? '').join('\n');
    for (const code of codes) expect(ownText.includes(code)).toBe(false);
    for (const value of [key, raw, ...codes.map((code) => `"${code}"`)]) {
      expect(logs.text().includes(value)).toBe(false);
    }
  });
});
