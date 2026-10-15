// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Email-first sign-up and password sign-in against the test database (ADR
// 0010): identical answers for every address, single-use links kept only as
// hashes, pre-hijacking, the common-password list, sessions and applicant
// memberships, the limits, and the auth events. Emails go to a fake sender;
// the common-password list is a small synthetic one. Each test signs in
// from its own address, so counters never meet.

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { connectionSettings, withClient } from '../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  testSlug,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { buildApp } from '../app.ts';
import { Secret } from '../config.ts';
import type { Email, Sender } from '../email/sender.ts';
import { createLogger } from '../logger.ts';
import { newToken } from './cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from './index.ts';
import type * as Passwords from './passwords.ts';
import { hashPassword, verifyPassword } from './passwords.ts';

// Watched, to show which requests cost a hash.
vi.mock('./passwords.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Passwords>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) };
});

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const HOSTS = { console: 'console.example.org', portal: 'apply.example.org' } as const;
type AppName = keyof typeof HOSTS;

const PASSWORD = 'a long synthetic passphrase';
const COMMON = 'Synthetic Common Password';

let app: FastifyInstance;
let auth: Auth;
const sent: Email[] = [];
/** While set, sending waits for it, to show that no response waits for an email. */
let gate: Promise<void> | undefined;

const sender: Sender = {
  async send(email) {
    await gate;
    sent.push(email);
    return { sent: true };
  },
};

/** A client address no other test, or earlier run, has used: counters outlive a run. */
const newAddress = () => `10.${[...randomBytes(3)].join('.')}`;
/** The first four groups of an IPv6 /64, as PostgreSQL writes them. */
const newNetwork = () =>
  `2001:db8:${[0, 2].map((at) => (1 + (randomBytes(4).readUInt16BE(at) % 0xfffe)).toString(16)).join(':')}`;

const newEmail = () => `${testSlug()}@example.test`;

function post(
  url: string,
  payload: object,
  options: { app?: AppName; ip?: string; headers?: Record<string, string> } = {},
) {
  const target = options.app ?? 'portal';
  return app.inject({
    method: 'POST',
    url: `/api${url}`,
    payload,
    remoteAddress: options.ip ?? '192.0.2.1',
    headers: { host: HOSTS[target], origin: ORIGINS[target], ...options.headers },
  });
}

const startSignUp = (slug: string, email: string, options?: Parameters<typeof post>[2]) =>
  post(`/auth/tenants/${slug}/sign-up`, { email }, options);
const completeSignUp = (token: string, password = PASSWORD, ip = '192.0.2.1') =>
  post('/auth/sign-up/complete', { token, password }, { ip });
const signIn = (
  slug: string,
  email: string,
  password: string,
  options?: Parameters<typeof post>[2],
) => post(`/auth/tenants/${slug}/sign-in`, { email, password }, options);

/** The last email to `to`, once it has been sent. */
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

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

/** An account with a password, written as app_auth, and its id. */
async function addAccount(email: string, password = PASSWORD): Promise<string> {
  const hash = await hashPassword(password);
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

/** What a response says, without what differs on every request. */
function shape(response: LightMyRequestResponse) {
  const headers = Object.fromEntries(
    Object.entries(response.headers).filter(([name]) => !['date', 'x-request-id'].includes(name)),
  );
  const body = response.body === '' ? '' : { ...response.json<object>(), requestId: undefined };
  return { status: response.statusCode, headers, body };
}

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
  const logger = createLogger({ level: 'silent' });
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
});

afterAll(async () => {
  gate = undefined;
  await app.close();
  await auth.close();
});

describe('starting a sign-up', { timeout: 60_000 }, () => {
  let tenant: TestTenant;
  beforeAll(async () => {
    tenant = await createTestTenant();
  });

  it('gives an unknown slug the same 404 as sign-in does', async () => {
    const slug = testSlug();
    const responses = [
      await startSignUp(slug, newEmail()),
      await signIn(slug, newEmail(), PASSWORD),
    ];
    expect(responses.map((r) => r.statusCode)).toEqual([404, 404]);
    expect(shape(responses[0] as LightMyRequestResponse)).toEqual(
      shape(responses[1] as LightMyRequestResponse),
    );
  });

  it('answers the same for an unknown, a pending and an existing address, without waiting for email', async () => {
    const pending = newEmail();
    await startSignUp(tenant.slug, pending, { ip: newAddress() });
    await emailTo(pending);
    const existing = newEmail();
    await addAccount(existing);

    let open = () => {};
    gate = new Promise((resolve) => (open = resolve));
    const unknown = newEmail();
    const responses = [
      await startSignUp(tenant.slug, unknown, { ip: newAddress() }),
      await startSignUp(tenant.slug, pending, { ip: newAddress() }),
      await startSignUp(tenant.slug, existing, { ip: newAddress() }),
    ];
    expect(sent.filter((email) => [unknown, existing].includes(email.to))).toEqual([]);
    open();
    gate = undefined;

    const [first, ...rest] = responses.map(shape);
    expect(first?.status).toBe(202);
    for (const other of rest) expect(other).toEqual(first);
    expect(tokenIn(await emailTo(unknown))).not.toBe('');
    expect(tokenIn(await emailTo(pending, 2))).not.toBe('');
  });

  it('emails a new address a single-use link to the app it came from, kept only as a hash', async () => {
    const email = newEmail();
    await startSignUp(tenant.slug, email, { app: 'console', ip: newAddress() });
    const message = await emailTo(email);
    expect(message.subject).toBe('Finish creating your Fairfold Grants account');
    expect(message.text).toContain('Test tenant');
    const token = tokenIn(message);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(message.text).toContain(
      `${ORIGINS.console}/${tenant.slug}/sign-up/complete#token=${token}`,
    );
    expect(message.text.split(token)).toHaveLength(2);

    const rows = await migrator<{ identifier: string; value: string; hours: number }>(
      `SELECT identifier, value, round(extract(epoch FROM expires_at - created_at) / 3600) AS hours
         FROM auth.verification WHERE value = $1`,
      [`sign_up:${email}`],
    );
    expect(rows).toEqual([
      {
        identifier: createHash('sha256').update(token).digest('base64url'),
        value: `sign_up:${email}`,
        hours: '24',
      },
    ]);
  });

  it('offers an existing account a sign-in or reset instead, with no link to sign up', async () => {
    const email = newEmail();
    await addAccount(email);
    await startSignUp(tenant.slug, email, { ip: newAddress() });
    const message = await emailTo(email);
    expect(message.subject).toBe('You already have a Fairfold Grants account');
    expect(message.text).toContain(`${ORIGINS.portal}/${tenant.slug}/sign-in`);
    expect(message.text).toContain(`${ORIGINS.portal}/${tenant.slug}/forgot-password`);
    expect(message.text).not.toContain('#token=');
  });

  it('replaces a pending link with a new one', async () => {
    const email = newEmail();
    await startSignUp(tenant.slug, email, { ip: newAddress() });
    const old = tokenIn(await emailTo(email));
    await startSignUp(tenant.slug, email, { ip: newAddress() });
    const latest = tokenIn(await emailTo(email, 2));
    expect((await completeSignUp(old)).statusCode).toBe(400);
    expect((await completeSignUp(latest)).statusCode).toBe(204);
  });

  it('allows 3 emails an hour to an address, unknown ones alike, then answers 429', async () => {
    const email = newEmail();
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await startSignUp(tenant.slug, email, { ip: newAddress() })).statusCode).toBe(202);
    }
    const refused = await startSignUp(tenant.slug, email, { ip: newAddress() });
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(3500);
    const reached = await migrator(
      `SELECT 1 FROM auth.audit_event WHERE code = 'rate_limit_reached' AND identifier = $1
          AND reason = 'email_identifier'`,
      [email],
    );
    expect(reached).toHaveLength(1);
  });

  it('allows 20 emails an hour from an address', async () => {
    const ip = newAddress();
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await startSignUp(tenant.slug, newEmail(), { ip })).statusCode).toBe(202);
    }
    expect((await startSignUp(tenant.slug, newEmail(), { ip })).statusCode).toBe(429);
  });
});

describe('completing a sign-up', { timeout: 60_000 }, () => {
  let tenant: TestTenant;
  beforeAll(async () => {
    tenant = await createTestTenant();
  });

  async function link(email: string): Promise<string> {
    await startSignUp(tenant.slug, email, { ip: newAddress() });
    return tokenIn(await emailTo(email));
  }

  it('creates the verified account and its password, records it, and does not sign in', async () => {
    const email = newEmail();
    const response = await completeSignUp(await link(email), PASSWORD, '203.0.113.21');
    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toBeUndefined();
    const [user] = await migrator<{ id: string; email_verified: boolean; password: string }>(
      `SELECT u.id, u.email_verified, a.password FROM auth."user" u
         JOIN auth.account a ON a.user_id = u.id WHERE u.email = $1`,
      [email],
    );
    expect(user?.email_verified).toBe(true);
    expect(await verifyPassword(user?.password ?? '', PASSWORD)).toBe(true);
    expect(await migrator('SELECT 1 FROM auth.session WHERE user_id = $1', [user?.id])).toEqual([]);
    const events = await migrator(
      `SELECT identifier, host(ip_address) AS ip, tenant_id FROM auth.audit_event
        WHERE code = 'account_created' AND user_id = $1`,
      [user?.id],
    );
    expect(events).toEqual([{ identifier: email, ip: '203.0.113.21', tenant_id: null }]);
  });

  it('spends the token: a second use, an expired token and a made-up one are refused, unhashed', async () => {
    const token = await link(newEmail());
    expect((await completeSignUp(token)).statusCode).toBe(204);
    expect(hashPassword).toHaveBeenCalled();
    vi.mocked(hashPassword).mockClear();
    const again = await completeSignUp(token);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({
      detail: 'This link is not valid. Use the link in your latest email, or ask for a new one.',
    });

    const expired = newToken();
    await migrator(
      `INSERT INTO auth.verification (identifier, value, expires_at, created_at)
       VALUES ($1, $2, now() - interval '1 minute', now() - interval '1 day')`,
      [createHash('sha256').update(expired).digest('base64url'), `sign_up:${newEmail()}`],
    );
    expect((await completeSignUp(expired)).statusCode).toBe(400);
    expect((await completeSignUp(newToken())).statusCode).toBe(400);
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('spends a link whose address has since gained an account, so it costs one hash at most', async () => {
    const email = newEmail();
    const token = await link(email);
    await addAccount(email, 'the first synthetic passphrase');
    expect((await completeSignUp(token)).statusCode).toBe(400);
    vi.mocked(hashPassword).mockClear();
    expect((await completeSignUp(token)).statusCode).toBe(400);
    expect(hashPassword).not.toHaveBeenCalled();
    const [account] = await migrator<{ password: string }>(
      `SELECT a.password FROM auth."user" u JOIN auth.account a ON a.user_id = u.id
        WHERE u.email = $1`,
      [email],
    );
    expect(await verifyPassword(account?.password ?? '', 'the first synthetic passphrase')).toBe(
      true,
    );
  });

  it('gives exactly one account when two completions race with one token', async () => {
    const email = newEmail();
    const token = await link(email);
    const statuses = (
      await Promise.all([completeSignUp(token, PASSWORD), completeSignUp(token, `${PASSWORD} 2`)])
    ).map((response) => response.statusCode);
    expect(statuses.sort()).toEqual([204, 400]);
    const accounts = await migrator(
      `SELECT 1 FROM auth."user" u JOIN auth.account a ON a.user_id = u.id WHERE u.email = $1`,
      [email],
    );
    expect(accounts).toHaveLength(1);
  });

  it('refuses a common password and leaves the token usable', async () => {
    const token = await link(newEmail());
    const refused = await completeSignUp(token, COMMON.toUpperCase());
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ errors: [{ field: 'body.password' }] });
    expect((await completeSignUp(token)).statusCode).toBe(204);
  });

  it.each([
    ['directly', false],
    ['after a link-scanning GET', true],
  ])(
    'leaves only the victim’s credential when an attacker signs up first (%s)',
    async (_case, scan) => {
      const victim = newEmail();
      // The attacker asks for a link to the victim's address, from another address.
      expect((await startSignUp(tenant.slug, victim, { ip: newAddress() })).statusCode).toBe(202);
      const attackerLink = tokenIn(await emailTo(victim));
      expect(await migrator('SELECT 1 FROM auth."user" WHERE email = $1', [victim])).toEqual([]);
      expect((await completeSignUp(newToken(), 'the attacker password')).statusCode).toBe(400);

      // The victim asks too, which replaces the first link, and follows the latest.
      await startSignUp(tenant.slug, victim, { ip: newAddress() });
      const token = tokenIn(await emailTo(victim, 2));
      if (scan) {
        for (const url of [
          `/api/auth/sign-up/complete?token=${token}`,
          '/api/auth/sign-up/complete',
        ]) {
          const response = await app.inject({ url, headers: { host: HOSTS.portal } });
          expect(response.statusCode).toBe(404);
        }
      }
      expect((await completeSignUp(attackerLink, 'the attacker password')).statusCode).toBe(400);
      expect((await completeSignUp(token)).statusCode).toBe(204);

      const accounts = await migrator<{ password: string }>(
        `SELECT a.password FROM auth."user" u JOIN auth.account a ON a.user_id = u.id
        WHERE u.email = $1`,
        [victim],
      );
      expect(accounts).toHaveLength(1);
      expect(await verifyPassword(accounts[0]?.password ?? '', PASSWORD)).toBe(true);
      expect(await verifyPassword(accounts[0]?.password ?? '', 'the attacker password')).toBe(
        false,
      );
    },
  );
});

describe('signing in', { timeout: 60_000 }, () => {
  let tenant: TestTenant;
  beforeAll(async () => {
    tenant = await createTestTenant();
  });

  async function memberships(userId: string) {
    return asMigratorIn(
      tenant.id,
      async (client) =>
        (
          await client.query<{ id: string; roles: string[] }>(
            'SELECT id, roles FROM app.membership WHERE user_id = $1',
            [userId],
          )
        ).rows,
    );
  }

  async function tenantAudit(entityId: string) {
    return asMigratorIn(tenant.id, async (client) =>
      (
        await client.query<{ action: string }>(
          'SELECT action FROM app.audit_event WHERE entity_id = $1',
          [entityId],
        )
      ).rows.map((row) => row.action),
    );
  }

  it('signs in to the portal as an applicant, made once, with the session and its event copied', async () => {
    const email = newEmail();
    const userId = await addAccount(email);
    const ip = newAddress();
    const response = await signIn(tenant.slug, email, PASSWORD, { ip });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toMatch(
      /^__Host-tps_portal_session=[A-Za-z0-9_-]{43};/,
    );
    const [membership] = await memberships(userId);
    expect(membership?.roles).toEqual(['applicant']);
    expect(response.json()).toMatchObject({
      app: 'portal',
      mfa: 'not_required',
      user: { id: userId, email },
      activeMembership: { id: membership?.id, roles: ['applicant'], tenant: { slug: tenant.slug } },
    });
    expect(await tenantAudit(membership?.id ?? '')).toEqual(['platform.membership.created']);

    const [event] = await migrator<{ id: string; identifier: string; ip: string }>(
      `SELECT id, identifier, host(ip_address) AS ip FROM auth.audit_event
        WHERE code = 'sign_in_succeeded' AND user_id = $1`,
      [userId],
    );
    expect(event).toMatchObject({ identifier: email, ip });
    expect(await tenantAudit(event?.id ?? '')).toEqual(['platform.auth.sign_in_succeeded']);

    expect((await signIn(tenant.slug, email, PASSWORD, { ip })).statusCode).toBe(200);
    expect(await memberships(userId)).toHaveLength(1);
  });

  it('starts a console session at MFA enrolment, or at a code once TOTP is set up, with no membership made', async () => {
    const email = newEmail();
    const userId = await addAccount(email);
    const first = await signIn(tenant.slug, email, PASSWORD, { app: 'console', ip: newAddress() });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ app: 'console', mfa: 'enrol', activeMembership: null });
    await withClient('app_auth', (client) =>
      client.query(
        'INSERT INTO auth.two_factor (user_id, secret, verified) VALUES ($1, $2, true)',
        [userId, 'a'.repeat(80)],
      ),
    );
    const second = await signIn(tenant.slug, email, PASSWORD, { app: 'console', ip: newAddress() });
    expect(second.json()).toMatchObject({ mfa: 'verify' });
    expect(await memberships(userId)).toEqual([]);
  });

  it('gives every failure the same problem, and an unknown address the cost of a hash', async () => {
    const email = newEmail();
    await addAccount(email);
    const started = performance.now();
    await hashPassword(PASSWORD);
    const hashTime = performance.now() - started;

    const timed = async (address: string, password: string) => {
      const start = performance.now();
      const response = await signIn(tenant.slug, address, password, { ip: newAddress() });
      return { response, ms: performance.now() - start };
    };
    const wrong = await timed(email, 'not the password at all');
    const unknown = await timed(newEmail(), PASSWORD);
    expect(wrong.response.statusCode).toBe(401);
    expect(shape(unknown.response)).toEqual(shape(wrong.response));
    expect(unknown.ms).toBeGreaterThan(hashTime / 2);
  });

  it('delays a client after 5 failures, refusing without checking or counting, then doubles', async () => {
    const email = newEmail();
    await addAccount(email);
    const ip = newAddress();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await signIn(tenant.slug, email, 'not the password', { ip })).statusCode).toBe(401);
    }
    const refused = await signIn(tenant.slug, email, PASSWORD, { ip });
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(25);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(30);
    expect(refused.headers['set-cookie']).toBeUndefined();
    const counter = () =>
      migrator<{ count: number }>(
        `SELECT count FROM auth.rate_limit WHERE scope = 'sign_in_identifier_ip' AND identifier = $1`,
        [email],
      );
    expect(await counter()).toEqual([{ count: 5 }]);
    expect(
      await migrator(
        `SELECT 1 FROM auth.audit_event WHERE code = 'rate_limit_reached' AND identifier = $1`,
        [email],
      ),
    ).toHaveLength(1);

    await migrator(
      `UPDATE auth.rate_limit SET blocked_until = now() - interval '1 second'
        WHERE scope = 'sign_in_identifier_ip' AND identifier = $1`,
      [email],
    );
    expect((await signIn(tenant.slug, email, 'not the password', { ip })).statusCode).toBe(401);
    const doubled = await signIn(tenant.slug, email, PASSWORD, { ip });
    expect(Number(doubled.headers['retry-after'])).toBeGreaterThan(55);
  });

  it('delays an unknown address in the same way, and forgets the doubling after 24 quiet hours', async () => {
    const email = newEmail();
    const ip = newAddress();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await signIn(tenant.slug, email, PASSWORD, { ip })).statusCode).toBe(401);
    }
    const refused = await signIn(tenant.slug, email, PASSWORD, { ip });
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(25);

    // The last failure 25 hours ago, after several delays. An update would set updated_at, so
    // the row is written again.
    await migrator(
      `WITH old AS (DELETE FROM auth.rate_limit WHERE scope = 'sign_in_identifier_ip' AND identifier = $1
                    RETURNING scope, identifier, client_ip)
       INSERT INTO auth.rate_limit (scope, identifier, client_ip, count, window_started_at,
                                    blocked_until, created_at, updated_at)
       SELECT scope, identifier, client_ip, 9, now() - interval '2 days',
              now() - interval '25 hours', now() - interval '2 days', now() - interval '25 hours'
         FROM old`,
      [email],
    );
    expect((await signIn(tenant.slug, email, PASSWORD, { ip })).statusCode).toBe(401);
    const [row] = await migrator<{ count: number; blocked: boolean }>(
      `SELECT count, blocked_until IS NOT NULL AS blocked FROM auth.rate_limit
        WHERE scope = 'sign_in_identifier_ip' AND identifier = $1`,
      [email],
    );
    expect(row).toEqual({ count: 1, blocked: false });
  });

  it('gives back the charge of a success, so earlier failures do not delay the next', async () => {
    const email = newEmail();
    await addAccount(email);
    const ip = newAddress();
    for (let attempt = 0; attempt < 4; attempt++) {
      await signIn(tenant.slug, email, 'not the password', { ip });
    }
    expect((await signIn(tenant.slug, email, PASSWORD, { ip })).statusCode).toBe(200);
    expect((await signIn(tenant.slug, email, 'not the password', { ip })).statusCode).toBe(401);
    expect((await signIn(tenant.slug, email, PASSWORD, { ip })).statusCode).toBe(200);
  });

  it('delays an identifier after 100 failures an hour from any address', async () => {
    const email = newEmail();
    await migrator(
      `INSERT INTO auth.rate_limit (scope, identifier, count) VALUES ('sign_in_identifier', $1, 99)`,
      [email],
    );
    expect((await signIn(tenant.slug, email, PASSWORD, { ip: newAddress() })).statusCode).toBe(401);
    expect((await signIn(tenant.slug, email, PASSWORD, { ip: newAddress() })).statusCode).toBe(429);
  });

  it('delays an address after 50 failures in 15 minutes, for any identifier', async () => {
    const ip = newAddress();
    await migrator(
      `INSERT INTO auth.rate_limit (scope, client_ip, count) VALUES ('sign_in_ip', $1::cidr, 49)`,
      [`${ip}/32`],
    );
    expect((await signIn(tenant.slug, newEmail(), PASSWORD, { ip })).statusCode).toBe(401);
    expect((await signIn(tenant.slug, newEmail(), PASSWORD, { ip })).statusCode).toBe(429);
  });

  it('counts the address Fastify derives, not a spoofed X-Forwarded-For, and an IPv6 /64 as one', async () => {
    const email = newEmail();
    const ip = newAddress();
    for (const forwarded of ['203.0.113.1', '203.0.113.2']) {
      await signIn(tenant.slug, email, PASSWORD, { ip, headers: { 'x-forwarded-for': forwarded } });
    }
    const network = newNetwork();
    for (const address of [`${network}::1`, `${network}:ffff::2`]) {
      await signIn(tenant.slug, email, PASSWORD, { ip: address });
    }
    const counted = await migrator<{ network: string; count: number }>(
      `SELECT client_ip::text AS network, count FROM auth.rate_limit
        WHERE scope = 'sign_in_identifier_ip' AND identifier = $1 ORDER BY network`,
      [email],
    );
    expect(counted).toEqual([
      { network: `${ip}/32`, count: 2 },
      { network: `${network}::/64`, count: 2 },
    ]);
  });

  it('records failures with their tenant for the copy, if the address has an account', async () => {
    const email = newEmail();
    const userId = await addAccount(email);
    await signIn(tenant.slug, email, 'not the password', { ip: '203.0.113.30' });
    const [event] = await migrator<{ id: string; tenant_id: string; reason: string }>(
      `SELECT id, tenant_id, reason FROM auth.audit_event WHERE code = 'sign_in_failed' AND user_id = $1`,
      [userId],
    );
    expect(event).toMatchObject({ tenant_id: tenant.id, reason: 'bad_password' });
    expect(
      await migrator('SELECT 1 FROM auth.audit_copy_pending WHERE auth_event_id = $1', [event?.id]),
    ).toHaveLength(1);
  });
});

describe('the auth tables', { timeout: 60_000 }, () => {
  it('hold no token or password in clear after a sign-up and sign-in', async () => {
    const tenant = await createTestTenant();
    const email = newEmail();
    await startSignUp(tenant.slug, email, { ip: newAddress() });
    const linkToken = tokenIn(await emailTo(email));
    const password = `clear text check ${randomUUID()}`;
    expect((await completeSignUp(linkToken, password)).statusCode).toBe(204);
    const response = await signIn(tenant.slug, email, password, { ip: newAddress() });
    const sessionToken = /=([^;]+);/.exec(String(response.headers['set-cookie']))?.[1] ?? '';
    expect(sessionToken).not.toBe('');

    const tables = await migrator<{ name: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname = 'auth'`,
    );
    for (const { name } of tables) {
      const rows = await migrator<{ row: string }>(`SELECT t::text AS row FROM ${name} t`);
      const text = rows.map((r) => r.row).join('\n');
      for (const secret of [linkToken, sessionToken, password]) {
        expect(text.includes(secret), `${name} holds a secret`).toBe(false);
      }
    }
  });
});
