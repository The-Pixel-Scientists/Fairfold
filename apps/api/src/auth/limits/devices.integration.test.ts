// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Device cookies and the sign-in limits, against the test database (ADR
// 0010, "Sign-in limits and passwords" and "Tests"): issued only when a
// sign-in completes, valid only when the signature, age, account and stored
// row all agree, relief for the owner's browser from failures elsewhere,
// revocation, the bounded purge, and no device id, cookie or hash in a log,
// problem or event. Each test signs in from its own addresses.

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createDatabase } from '@pixel-scientists/db';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  connectionSettings,
  databaseSettings,
  withClient,
} from '../../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  testSlug,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { captureLogs, tenantId } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { Secret } from '../../config.ts';
import type { Email, Sender } from '../../email/sender.ts';
import { createLogger } from '../../logger.ts';
import { newToken } from '../cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from '../index.ts';
import { hashPassword } from '../passwords.ts';
import { codeAt, stepAt } from '../totp.ts';
import { deviceCookie, deviceKeys, newDeviceId } from './device-cookie.ts';
import { deleteExpiredDevices } from './devices.ts';

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const HOSTS = { console: 'console.example.org', portal: 'apply.example.org' } as const;
type AppName = keyof typeof HOSTS;
const PASSWORD = 'a long synthetic passphrase';
const WRONG = 'not the password at all';
const SECRET = newToken();
const keys = deviceKeys(new Secret(SECRET));

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
/** Every response, to look for device ids and cookies in. */
const bodies: string[] = [];

const newAddress = () => `10.${[...randomBytes(3)].join('.')}`;

interface Options {
  readonly app?: AppName;
  readonly ip?: string;
  /** Cookies to send, as name=value pairs. */
  readonly cookies?: readonly string[];
  readonly slug?: string;
}

async function post(url: string, payload: object | undefined, options: Options = {}) {
  const target = options.app ?? 'portal';
  const response = await app.inject({
    method: 'POST',
    url: `/api${url}`,
    ...(payload === undefined ? {} : { payload }),
    remoteAddress: options.ip ?? newAddress(),
    headers: {
      host: HOSTS[target],
      origin: ORIGINS[target],
      ...(options.cookies === undefined ? {} : { cookie: options.cookies.join('; ') }),
    },
  });
  bodies.push(response.body);
  return response;
}

const signIn = (email: string, password: string, options: Options = {}) =>
  post(`/auth/tenants/${options.slug ?? tenant.slug}/sign-in`, { email, password }, options);

/** The name=value pair of the response's Set-Cookie header named `name`, if any. */
function cookieNamed(response: LightMyRequestResponse, name: string): string | undefined {
  const headers = [response.headers['set-cookie'] ?? []].flat();
  return headers.find((header) => header.startsWith(`${name}=`))?.split(';', 1)[0];
}
const deviceOf = (response: LightMyRequestResponse, target: AppName = 'portal') =>
  cookieNamed(response, `__Host-tps_${target}_device`);

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

interface Account {
  readonly email: string;
  readonly userId: string;
}

async function addAccount(): Promise<Account> {
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
  return { email, userId };
}

/** A new account signed in to the portal, and its device cookie. */
async function knownDevice(): Promise<Account & { cookie: string }> {
  const account = await addAccount();
  const response = await signIn(account.email, PASSWORD);
  expect(response.statusCode).toBe(200);
  return { ...account, cookie: deviceOf(response) ?? '' };
}

/** The account's sign-in counters by scope. */
async function counters(email: string): Promise<Record<string, number>> {
  const rows = await migrator<{ scope: string; count: number }>(
    `SELECT scope, sum(count)::int AS count FROM auth.rate_limit
      WHERE identifier = $1 AND scope LIKE 'sign_in_%' GROUP BY scope HAVING sum(count) > 0`,
    [email],
  );
  return Object.fromEntries(rows.map((row) => [row.scope, row.count]));
}

const devices = (userId: string) =>
  migrator<{ revoked: boolean }>(
    `SELECT revoked_at IS NOT NULL AS revoked FROM auth.device
      WHERE user_id = $1 ORDER BY issued_at`,
    [userId],
  );

/** What a response says, without what differs on every request. */
function shape(response: LightMyRequestResponse) {
  const headers = Object.fromEntries(
    Object.entries(response.headers).filter(
      ([name]) => !['date', 'x-request-id', 'retry-after'].includes(name),
    ),
  );
  return {
    status: response.statusCode,
    headers,
    body: { ...response.json<object>(), requestId: 0 },
  };
}

beforeAll(async () => {
  const api = connectionSettings('app_api');
  const settings = loadAuthSettings({
    TPS_DEV: '1',
    TPS_DB_HOST: api.host,
    TPS_AUTH_SECRET: SECRET,
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
  tenant = await createTestTenant();
});

afterAll(async () => {
  await app.close();
  await auth.close();
});

describe('the device cookie', { timeout: 60_000 }, () => {
  it('is issued when a portal sign-in completes, never on a failure, and kept on the next', async () => {
    const account = await addAccount();
    expect(deviceOf(await signIn(account.email, WRONG))).toBeUndefined();
    const first = await signIn(account.email, PASSWORD);
    expect(String(first.headers['set-cookie'])).toMatch(
      /__Host-tps_portal_device=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=31536000/,
    );
    const cookie = deviceOf(first) ?? '';
    expect(cookie).not.toContain(account.email);
    expect(cookie).not.toContain(tenant.id);
    const deviceId = cookie.split('.')[1] ?? '';
    const [row] = await migrator<{ hash: Buffer; version: number }>(
      'SELECT device_hash AS hash, key_version AS version FROM auth.device WHERE user_id = $1',
      [account.userId],
    );
    expect(row).toEqual({ hash: createHash('sha256').update(deviceId).digest(), version: 1 });

    const second = await signIn(account.email, PASSWORD, { cookies: [cookie] });
    expect(second.statusCode).toBe(200);
    expect(deviceOf(second)).toBeUndefined();
    expect(await devices(account.userId)).toHaveLength(1);
  });

  it('is issued for the console only when MFA completes', async () => {
    const account = await addAccount();
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.membership', {
        tenant_id: tenant.id,
        user_id: account.userId,
        roles: ['tenant_admin'],
      }),
    );
    const ip = newAddress();
    const pending = await signIn(account.email, PASSWORD, { app: 'console', ip });
    expect(pending.json()).toMatchObject({ mfa: 'enrol' });
    expect(deviceOf(pending, 'console')).toBeUndefined();
    const session = cookieNamed(pending, '__Host-tps_console_session') ?? '';
    const enrolled = await post('/auth/totp/enrol', undefined, {
      app: 'console',
      ip,
      cookies: [session],
    });
    const key = enrolled.json<{ key: string }>().key;
    const left = 30_000 - (Date.now() % 30_000);
    if (left < 8000) await delay(left + 100);
    const code = codeAt(fromBase32(key), stepAt(Date.now()));
    const done = await post(
      '/auth/totp/confirm',
      { code },
      { app: 'console', ip, cookies: [session] },
    );
    expect(done.statusCode).toBe(200);
    expect(deviceOf(done, 'console')).toMatch(/^__Host-tps_console_device=1\./);
    expect(await counters(account.email)).toEqual({});
  });

  it('replaces the cookie when another account signs in on the browser', async () => {
    const owner = await knownDevice();
    const other = await addAccount();
    const response = await signIn(other.email, PASSWORD, { cookies: [owner.cookie] });
    expect(deviceOf(response)).not.toBe(owner.cookie);
    expect(await devices(other.userId)).toEqual([{ revoked: false }]);
    expect(await devices(owner.userId)).toEqual([{ revoked: false }]);
  });

  it('gives no session, membership or tenant elsewhere: it only moves a failure to its counter', async () => {
    const owner = await knownDevice();
    const elsewhere = await createTestTenant();
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { host: HOSTS.portal, cookie: owner.cookie },
    });
    expect(session.statusCode).toBe(401);
    const failed = await signIn(owner.email, WRONG, {
      slug: elsewhere.slug,
      cookies: [owner.cookie],
    });
    expect(failed.statusCode).toBe(401);
    expect(await counters(owner.email)).toEqual({ sign_in_identifier_device: 1 });
    const memberships = await asMigratorIn(elsewhere.id, async (client) => {
      const { rowCount } = await client.query('SELECT 1 FROM app.membership WHERE user_id = $1', [
        owner.userId,
      ]);
      return rowCount;
    });
    expect(memberships).toBe(0);
  });
});

describe('the limits with a device cookie', { timeout: 60_000 }, () => {
  it('count per identifier and device: 5 failures, then a delay that refuses without counting', async () => {
    const owner = await knownDevice();
    const ip = newAddress();
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await signIn(owner.email, WRONG, { ip, cookies: [owner.cookie] });
      expect(response.statusCode).toBe(401);
    }
    const refused = await signIn(owner.email, PASSWORD, { ip, cookies: [owner.cookie] });
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(25);
    expect(await counters(owner.email)).toEqual({ sign_in_identifier_device: 5 });
  });

  it('never delay the owner for failures from other clients, by identifier or address', async () => {
    const owner = await knownDevice();
    const attacker = newAddress();
    for (let attempt = 0; attempt < 5; attempt++)
      await signIn(owner.email, WRONG, { ip: attacker });
    expect((await signIn(owner.email, PASSWORD, { ip: attacker })).statusCode).toBe(429);

    // 100 failures an hour for the identifier, from anywhere.
    await migrator(
      `UPDATE auth.rate_limit SET count = 99 WHERE scope = 'sign_in_identifier' AND identifier = $1`,
      [owner.email],
    );
    expect((await signIn(owner.email, WRONG)).statusCode).toBe(401);
    expect((await signIn(owner.email, PASSWORD)).statusCode).toBe(429);

    // 50 failures in 15 minutes from the owner's own address.
    const shared = newAddress();
    await migrator(
      `INSERT INTO auth.rate_limit (scope, client_ip, count) VALUES ('sign_in_ip', $1::cidr, 49)`,
      [`${shared}/32`],
    );
    expect((await signIn(`${testSlug()}@example.test`, WRONG, { ip: shared })).statusCode).toBe(
      401,
    );
    expect((await signIn(owner.email, PASSWORD, { ip: shared })).statusCode).toBe(429);

    const ok = await signIn(owner.email, PASSWORD, { ip: shared, cookies: [owner.cookie] });
    expect(ok.statusCode).toBe(200);
  });

  it('delay a fresh identifier from anywhere in a /64 after 50 failures from it, without the cookie', async () => {
    const network = `2001:db8:${randomBytes(2).readUInt16BE(0).toString(16)}:${randomBytes(2).readUInt16BE(0).toString(16)}`;
    await migrator(
      `INSERT INTO auth.rate_limit (scope, client_ip, count) VALUES ('sign_in_ip', $1::cidr, 49)`,
      [`${network}::/64`],
    );
    expect(
      (await signIn(`${testSlug()}@example.test`, WRONG, { ip: `${network}::1` })).statusCode,
    ).toBe(401);
    const fresh = await signIn(`${testSlug()}@example.test`, PASSWORD, { ip: `${network}:1::2` });
    expect(fresh.statusCode).toBe(429);
  });

  it('delay an unknown identifier as they delay a known one', async () => {
    const known = await addAccount();
    const delayed = async (email: string) => {
      const ip = newAddress();
      for (let attempt = 0; attempt < 5; attempt++) await signIn(email, WRONG, { ip });
      return signIn(email, PASSWORD, { ip });
    };
    const [one, two] = [await delayed(known.email), await delayed(`${testSlug()}@example.test`)];
    expect(shape(one)).toEqual(shape(two));
    expect(one.statusCode).toBe(429);
  });
});

describe('a cookie that is not valid', { timeout: 60_000 }, () => {
  /** Sign in wrongly with `cookie`, and give the counters that reached; then without one, alike. */
  async function counted(email: string, cookie: string) {
    await migrator('DELETE FROM auth.rate_limit WHERE identifier = $1', [email]);
    const failed = await signIn(email, WRONG, { cookies: [cookie] });
    const reached = await counters(email);
    const none = await signIn(email, WRONG);
    expect(shape(failed)).toEqual(shape(none));
    return reached;
  }
  const asNone = { sign_in_identifier: 1, sign_in_identifier_ip: 1 };

  it('counts as none when forged, tampered, auth-secret-signed, unknown or for another account', async () => {
    const owner = await knownDevice();
    const other = await knownDevice();
    const value = owner.cookie.split('=')[1] ?? '';
    const payload = value.slice(0, value.lastIndexOf('.'));
    const [, deviceId = '', , issued = ''] = payload.split('.');
    const signed = (signing: typeof keys, id: string) =>
      deviceCookie('portal', signing, {
        version: 1,
        deviceId: id,
        userId: owner.userId,
        issuedAt: Number(issued),
      }).split(';', 1)[0] ?? '';
    const raw = createHmac('sha256', SECRET).update(payload).digest('base64url');
    const cookies = {
      forged: signed(deviceKeys(new Secret(newToken())), deviceId),
      tampered: owner.cookie.replace(/.$/, (last) => (last === 'A' ? 'B' : 'A')),
      'auth-secret-signed': `__Host-tps_portal_device=${payload}.${raw}`,
      unknown: signed(keys, newDeviceId()),
      'for another account': other.cookie,
    };
    for (const [kind, cookie] of Object.entries(cookies)) {
      expect(await counted(owner.email, cookie), kind).toEqual(asNone);
    }
    expect(await counted(owner.email, owner.cookie)).toEqual({ sign_in_identifier_device: 1 });
  });

  it('counts as none once its row is 12 months old', async () => {
    const owner = await knownDevice();
    await migrator(
      `UPDATE auth.device SET issued_at = now() - interval '12 months',
                              last_used_at = now() - interval '12 months'
        WHERE user_id = $1`,
      [owner.userId],
    );
    expect(await counted(owner.email, owner.cookie)).toEqual(asNone);
  });
});

describe('revoking devices', { timeout: 60_000 }, () => {
  const refused = async (owner: Account & { cookie: string }) => {
    await signIn(owner.email, WRONG, { cookies: [owner.cookie] });
    return counters(owner.email);
  };

  it('happens on sign out everywhere, but not on signing out one session or one tenant', async () => {
    const owner = await knownDevice();
    const signedIn = await signIn(owner.email, PASSWORD, { cookies: [owner.cookie] });
    const session = cookieNamed(signedIn, '__Host-tps_portal_session') ?? '';
    const out = await post('/auth/sign-out', undefined, { cookies: [session] });
    expect(out.statusCode).toBe(204);
    await auth.revokeSessions({
      userId: owner.userId,
      tenant: tenantId(tenant.id),
      requestId: randomUUID(),
    });
    expect(await devices(owner.userId)).toEqual([{ revoked: false }]);

    await auth.revokeSessions({ userId: owner.userId, requestId: randomUUID() });
    expect(await devices(owner.userId)).toEqual([{ revoked: true }]);
    expect(await refused(owner)).toEqual({ sign_in_identifier: 1, sign_in_identifier_ip: 1 });
  });

  it('happens on a completed password reset, which clears the device counters too', async () => {
    const owner = await knownDevice();
    await signIn(owner.email, WRONG, { cookies: [owner.cookie] });
    expect(await counters(owner.email)).toEqual({ sign_in_identifier_device: 1 });
    await post(`/auth/tenants/${tenant.slug}/password-reset`, { email: owner.email });
    const email = await waitFor(() => sent.find((message) => message.to === owner.email));
    const token = /#token=([A-Za-z0-9_-]+)/.exec(email.text)?.[1] ?? '';
    const reset = await post('/auth/password-reset/complete', {
      token,
      password: 'a new long synthetic passphrase',
    });
    expect(reset.statusCode).toBe(204);
    expect(await devices(owner.userId)).toEqual([{ revoked: true }]);
    expect(await counters(owner.email)).toEqual({});
    expect(await refused(owner)).toEqual({ sign_in_identifier: 1, sign_in_identifier_ip: 1 });
  });

  it('is what deactivation does to the cookie, and an inactive account has no device', async () => {
    const owner = await knownDevice();
    await migrator(`UPDATE auth."user" SET status = 'deactivated' WHERE id = $1`, [owner.userId]);
    expect(await refused(owner)).toEqual({ sign_in_identifier: 1, sign_in_identifier_ip: 1 });
  });
});

describe('the device purge', { timeout: 60_000 }, () => {
  it('deletes expired and long-revoked devices in bounded batches, and keeps the rest', async () => {
    const { userId } = await addAccount();
    await migrator(
      `INSERT INTO auth.device (user_id, device_hash, key_version, issued_at, last_used_at, revoked_at)
       SELECT $1::uuid, sha256(convert_to(n || $1::uuid::text, 'UTF8')), 1, issued, issued, revoked
         FROM (VALUES
           (1, now() - interval '13 months', NULL::timestamptz),
           (2, now() - interval '2 months', now() - interval '31 days'),
           (3, now() - interval '2 months', now() - interval '29 days'),
           (4, now() - interval '1 day', NULL)) AS d(n, issued, revoked)`,
      [userId],
    );
    const db = createDatabase<unknown>(databaseSettings('app_auth', 1));
    try {
      expect(await deleteExpiredDevices(db, 1)).toBe(1);
      let deleted;
      do deleted = await deleteExpiredDevices(db, 100);
      while (deleted > 0);
    } finally {
      await db.destroy();
    }
    expect(await devices(userId)).toEqual([{ revoked: true }, { revoked: false }]);
  });
});

describe('device ids, cookies and hashes', { timeout: 60_000 }, () => {
  it('never appear in a log line, problem response or auth event', async () => {
    const owner = await knownDevice();
    await signIn(owner.email, WRONG, { cookies: [owner.cookie] });
    const value = owner.cookie.split('=')[1] ?? '';
    const deviceId = value.split('.')[1] ?? '';
    const [row] = await migrator<{ id: string; hash: string }>(
      `SELECT id, encode(device_hash, 'hex') AS hash FROM auth.device WHERE user_id = $1`,
      [owner.userId],
    );
    const events = await migrator<{ row: string }>(
      'SELECT t::text AS row FROM auth.audit_event t WHERE user_id = $1',
      [owner.userId],
    );
    expect(events.length).toBeGreaterThan(1);
    const seen = [logs.text(), ...bodies, ...events.map((event) => event.row)].join('\n');
    for (const secret of [value, deviceId, row?.id ?? '', row?.hash ?? '']) {
      expect(secret).not.toBe('');
      expect(seen.includes(secret)).toBe(false);
    }
  });
});

async function waitFor<T>(find: () => T | undefined): Promise<T> {
  for (let tries = 0; tries < 100; tries++) {
    const found = find();
    if (found !== undefined) return found;
    await delay(100);
  }
  throw new Error('Nothing was found in time.');
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
