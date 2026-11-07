// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changing the sign-in email address, against the test database (ADR 0010):
// step-up on a clock, the same answer whatever the new address, a link that
// works once, the address re-checked when it is spent, every other session
// and device cookie revoked while this browser goes on under a new session
// id, a pending link cancelled by signing out everywhere or a password
// reset, the events and emails, and no address or token anywhere it should
// not be.

import { randomBytes, randomUUID } from 'node:crypto';

import { createDatabase, type Kysely } from '@pixel-scientists/db';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  connectionSettings,
  databaseSettings,
  withClient,
} from '../../../../../packages/db/test/connect.ts';
import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';
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
import { hashToken, newToken } from '../cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from '../index.ts';
import { hashPassword } from '../passwords.ts';
import { issueToken, tokenIdentifier } from './token.ts';

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const HOST = 'apply.example.org';
const PASSWORD = 'a long synthetic passphrase';
const SESSION = '__Host-tps_portal_session';
const DEVICE = '__Host-tps_portal_device';
const SECRET = newToken();
const identify = tokenIdentifier(new Secret(SECRET));

let app: FastifyInstance;
let auth: Auth;
let authDb: Kysely<unknown>;
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
  return app.inject({
    method: 'POST',
    url: `/api${path}`,
    remoteAddress: ip,
    payload,
    headers: {
      host: HOST,
      origin: ORIGINS.portal,
      ...(cookies.length === 0 ? {} : { cookie: cookies.join('; ') }),
    },
  });
}

/** The email change routes' answers, kept to check what they disclose. */
async function kept(response: Promise<LightMyRequestResponse>) {
  const answer = await response;
  bodies.push(answer.body);
  return answer;
}

const getSession = (token: string) =>
  app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: { host: HOST, cookie: `${SESSION}=${token}` },
  });

function cookieNamed(response: LightMyRequestResponse, name: string): string | undefined {
  const headers = [response.headers['set-cookie'] ?? []].flat();
  return headers.find((header) => header.startsWith(`${name}=`))?.split(';', 1)[0];
}
const tokenOf = (response: LightMyRequestResponse) =>
  cookieNamed(response, SESSION)?.slice(SESSION.length + 1) ?? '';

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

const newAddress = () => `${testSlug()}@example.test`;
const randomIp = () => `10.${[...randomBytes(3)].join('.')}`;

/** An account, with a password unless an IdP made it. */
async function addUser(password = true): Promise<User> {
  const email = newAddress();
  const hash = await hashPassword(PASSWORD);
  const userId = await withClient('app_auth', async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO auth."user" (email, email_verified) VALUES ($1, true) RETURNING id',
      [email],
    );
    const id = rows[0]?.id ?? '';
    if (password) {
      await client.query(
        `INSERT INTO auth.account (user_id, account_id, provider_id, password)
         VALUES ($1::uuid, $1::text, 'credential', $2)`,
        [id, hash],
      );
    }
    return id;
  });
  return { email, userId, ip: randomIp() };
}

/** A portal session for `user` that re-authenticated just now. */
async function addSession(user: User, mfa = 'not_required'): Promise<string> {
  const token = newToken();
  await migrator(
    `INSERT INTO auth.session (user_id, token_hash, app, active_tenant_id, mfa_state, expires_at,
                               reauthenticated_at, ip_address)
     VALUES ($1, $2, 'portal', $3, $4, now() + interval '1 day', now(), '192.0.2.1')`,
    [user.userId, hashToken(token), tenant.id, mfa],
  );
  return token;
}

/** A portal session through sign-in, and its device cookie. */
async function signedIn(user: User) {
  const response = await post(
    `/auth/tenants/${tenant.slug}/sign-in`,
    { email: user.email, password: PASSWORD },
    [],
    user.ip,
  );
  expect(response.statusCode).toBe(200);
  return { token: tokenOf(response), device: cookieNamed(response, DEVICE) ?? '' };
}

const request = (token: string, payload: object, ip?: string) =>
  kept(post('/auth/account/email', payload, [`${SESSION}=${token}`], ip));

const complete = (token: string, cookies: string[] = []) =>
  kept(post('/auth/email-change/complete', { token }, cookies));

const emailOf = async (userId: string) =>
  (await migrator<{ email: string }>('SELECT email FROM auth."user" WHERE id = $1', [userId]))[0]
    ?.email;

/** The token in the latest link sent to `to`. */
async function linkSentTo(to: string): Promise<string> {
  let token = '';
  await vi.waitFor(() => {
    const link = sent.filter((email) => email.to === to).at(-1);
    token = /#token=([A-Za-z0-9_-]+)/.exec(link?.text ?? '')?.[1] ?? '';
    expect(token).not.toBe('');
  });
  return token;
}

/** Ask for a change from a fresh session and return the link's token. */
async function linkFor(user: User, to = newAddress()) {
  expect((await request(await addSession(user), { email: to }, randomIp())).statusCode).toBe(202);
  return { to, token: await linkSentTo(to) };
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
  });
  app = await buildApp({ logger, checkDatabase: () => Promise.resolve(), auth });
  tenant = await createTestTenant();
  authDb = createDatabase(databaseSettings('app_auth', 2));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await authDb.destroy();
  await app.close();
  await auth.close();
});

describe('asking to change the email address', { timeout: 120_000 }, () => {
  it('needs a session that re-authenticated within 5 minutes', async () => {
    const user = await addUser();
    const token = await addSession(user);
    const now = Date.now();
    await migrator('UPDATE auth.session SET reauthenticated_at = $2 WHERE token_hash = $1', [
      hashToken(token),
      new Date(now),
    ]);
    vi.useFakeTimers({ toFake: ['Date'], now: now + 5 * 60_000 + 1000 });
    expect((await request(token, { email: newAddress() })).statusCode).toBe(403);
    vi.setSystemTime(now + 4 * 60_000 + 59_000);
    expect((await request(token, { email: newAddress() })).statusCode).toBe(202);
  });

  it('refuses a session waiting for MFA', async () => {
    const user = await addUser();
    const token = await addSession(user, 'verify');
    expect((await request(token, { email: newAddress() })).statusCode).toBe(401);
  });

  it('takes the user from the session, never the body', async () => {
    const user = await addUser();
    const other = await addUser();
    const token = await addSession(user);
    const response = await request(token, { email: newAddress(), userId: other.userId });
    expect(response.statusCode).toBe(400);
  });

  it('refuses an account an IdP created, saying who manages it', async () => {
    const user = await addUser(false);
    const response = await request(await addSession(user), { email: newAddress() });
    expect(response.statusCode).toBe(403);
    expect(response.body).toMatch(/organisation manages how you sign in/);
  });

  it('answers the same whether the address is free, taken or your own', async () => {
    const user = await addUser();
    const other = await addUser();
    const free = newAddress();
    const answers = new Map<string, { status: number; body: string; ms: number[] }>();
    for (const [name, email] of [
      ['free', free],
      ['taken', other.email],
      ['own', user.email],
    ] as const) {
      const ms: number[] = [];
      let last: LightMyRequestResponse | undefined;
      for (let i = 0; i < 3; i += 1) {
        const token = await addSession(user);
        const started = performance.now();
        last = await request(token, { email: email.toUpperCase() }, randomIp());
        ms.push(performance.now() - started);
      }
      answers.set(name, { status: last?.statusCode ?? 0, body: last?.body ?? '', ms });
    }
    const all = [...answers.values()];
    expect(new Set(all.map(({ status, body }) => `${status} ${body}`))).toEqual(new Set(['202 ']));
    const medians = all.map(({ ms }) => [...ms].sort((a, b) => a - b)[1] ?? 0);
    expect(Math.max(...medians) - Math.min(...medians)).toBeLessThan(250);

    await linkSentTo(free);
    await vi.waitFor(() => {
      expect(sent.filter((email) => email.to === other.email)).toHaveLength(3);
      expect(sent.filter((email) => email.to === user.email)).toHaveLength(3);
    });
    for (const email of sent.filter(({ to }) => to === other.email || to === user.email)) {
      expect(email.subject).toMatch(/already have/);
      expect(email.text).not.toContain(user.email);
      expect(email.text).not.toMatch(/#token=/);
    }
    for (const address of [free, other.email, user.email]) {
      expect(logs.text()).not.toContain(address);
      for (const body of bodies) expect(body).not.toContain(address);
    }
  });

  it('keeps a link only as its HMAC, for 1 hour, and replaces an earlier one', async () => {
    const user = await addUser();
    const first = await linkFor(user);
    const second = await linkFor(user);
    expect(
      await migrator(
        `SELECT identifier, value, round(extract(epoch FROM expires_at - created_at) / 60) AS minutes
           FROM auth.verification WHERE value LIKE $1`,
        [`email_change:${user.userId}:%`],
      ),
    ).toEqual([
      {
        identifier: identify(second.token),
        value: `email_change:${user.userId}:${tenant.id}:${second.to}`,
        minutes: '60',
      },
    ]);
    expect((await complete(first.token)).statusCode).toBe(400);
    expect((await complete(second.token)).statusCode).toBe(204);
    expect(await emailOf(user.userId)).toBe(second.to);
  });

  it('issues no link once the session that asked is revoked', async () => {
    const user = await addUser();
    const session = await addSession(user);
    await migrator('UPDATE auth.session SET revoked_at = now() WHERE token_hash = $1', [
      hashToken(session),
    ]);
    const change = {
      userId: user.userId,
      tenantId: trustedTenantId(tenant.id),
      email: newAddress(),
    };
    expect(await issueToken(authDb, identify, change, hashToken(session))).toBeUndefined();
    expect(
      await migrator('SELECT 1 FROM auth.verification WHERE value LIKE $1', [
        `email_change:${user.userId}:%`,
      ]),
    ).toEqual([]);
  });
});

describe('completing an email change', { timeout: 120_000 }, () => {
  it('leaves Better Auth’s own verification routes unanswered', async () => {
    for (const [method, url] of [
      ['GET', '/api/auth/verify-email?token=x'],
      ['POST', '/api/auth/change-email'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { host: HOST, origin: ORIGINS.portal },
        ...(method === 'POST' ? { payload: { newEmail: newAddress() } } : {}),
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it('changes the address, keeps this browser under a new id and signs out the rest', async () => {
    const user = await addUser();
    const { token: session, device } = await signedIn(user);
    const other = await signedIn(user);
    const { to, token } = await linkFor(user);

    const response = await complete(token, [`${SESSION}=${session}`, device]);
    expect(response.statusCode).toBe(204);
    expect(await emailOf(user.userId)).toBe(to);
    const next = tokenOf(response);
    expect(next).not.toBe('');
    expect(next).not.toBe(session);
    expect((await getSession(session)).statusCode).toBe(401);
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

    const events = await migrator<{ code: string; reason: string | null; tenant_id: string }>(
      `SELECT code, reason, tenant_id FROM auth.audit_event
        WHERE user_id = $1 AND code IN ('email_changed', 'sessions_revoked') ORDER BY code`,
      [user.userId],
    );
    expect(events).toEqual([
      { code: 'email_changed', reason: null, tenant_id: tenant.id },
      { code: 'sessions_revoked', reason: 'email_changed', tenant_id: tenant.id },
    ]);
    const copies = await asMigratorIn(tenant.id, async (client) =>
      (
        await client.query<{ action: string }>(
          `SELECT action FROM app.audit_event
            WHERE entity_id IN (SELECT id FROM auth.audit_event WHERE user_id = $1)`,
          [user.userId],
        )
      ).rows.map((row) => row.action),
    );
    expect(copies).toEqual(
      expect.arrayContaining(['platform.auth.email_changed', 'platform.auth.sessions_revoked']),
    );

    await vi.waitFor(() => {
      expect(
        sent.some((email) => email.to === user.email && /was changed/.test(email.subject)),
      ).toBe(true);
      expect(sent.some((email) => email.to === to && /has changed/.test(email.subject))).toBe(true);
    });
    const notice = sent.find(
      (email) => email.to === user.email && /was changed/.test(email.subject),
    );
    expect(notice?.text).not.toMatch(/https?:/);
    expect(notice?.text).not.toContain(to);

    const stored = await migrator<{ text: string }>(
      `SELECT a::text AS text FROM auth.audit_event AS a
        WHERE user_id = $1 AND code IN ('email_changed', 'sessions_revoked')`,
      [user.userId],
    );
    const copied = await asMigratorIn(
      tenant.id,
      async (client) =>
        (
          await client.query<{ text: string }>(
            `SELECT e::text AS text FROM app.audit_event AS e
            WHERE entity_id IN (SELECT id FROM auth.audit_event WHERE user_id = $1)`,
            [user.userId],
          )
        ).rows,
    );
    for (const secret of [token, to, user.email]) {
      expect([...stored, ...copied].filter(({ text }) => text.includes(secret))).toEqual([]);
      expect(logs.text()).not.toContain(secret);
      for (const body of bodies) expect(body).not.toContain(secret);
    }
  });

  it('signs out every session when the browser is not signed in', async () => {
    const user = await addUser();
    const { token: session } = await signedIn(user);
    const { token } = await linkFor(user);
    const response = await complete(token);
    expect(response.statusCode).toBe(204);
    expect(cookieNamed(response, SESSION)).toBeUndefined();
    expect((await getSession(session)).statusCode).toBe(401);
    expect(
      await migrator<{ live: number }>(
        `SELECT count(*)::int AS live FROM auth.session WHERE user_id = $1 AND revoked_at IS NULL`,
        [user.userId],
      ),
    ).toEqual([{ live: 0 }]);

    const events = await migrator<{ id: string }>(
      `SELECT id FROM auth.audit_event
        WHERE user_id = $1 AND tenant_id = $2 AND code IN ('email_changed', 'sessions_revoked')`,
      [user.userId, tenant.id],
    );
    expect(events).toHaveLength(2);
    const ids = events.map(({ id }) => id);
    const copies = await asMigratorIn(tenant.id, async (client) =>
      (
        await client.query<{ action: string }>(
          'SELECT action FROM app.audit_event WHERE entity_id = ANY($1::uuid[]) ORDER BY action',
          [ids],
        )
      ).rows.map((row) => row.action),
    );
    expect(copies).toEqual(['platform.auth.email_changed', 'platform.auth.sessions_revoked']);
    expect(
      await migrator(
        'SELECT 1 FROM auth.audit_copy_pending WHERE auth_event_id = ANY($1::uuid[])',
        [ids],
      ),
    ).toEqual([]);
  });

  it('cancels a pending link when the account is signed out everywhere', async () => {
    const user = await addUser();
    const { token } = await linkFor(user);
    await auth.revokeSessions({ userId: user.userId, requestId: randomUUID() });
    const response = await complete(token);
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatch(/link is not valid/);
    expect(await emailOf(user.userId)).toBe(user.email);
  });

  it('cancels a pending link when the password is reset', async () => {
    const user = await addUser();
    const { token } = await linkFor(user);
    const reset = post(
      `/auth/tenants/${tenant.slug}/password-reset`,
      { email: user.email },
      [],
      randomIp(),
    );
    expect((await reset).statusCode).toBe(202);
    const resetToken = await linkSentTo(user.email);
    const done = await post(
      '/auth/password-reset/complete',
      { token: resetToken, password: 'a new synthetic passphrase' },
      [],
      randomIp(),
    );
    expect(done.statusCode).toBe(204);
    expect((await complete(token)).statusCode).toBe(400);
    expect(await emailOf(user.userId)).toBe(user.email);
  });

  it('gives the same answer for a spent, expired, malformed or someone else’s link', async () => {
    const user = await addUser();
    const spent = await linkFor(user);
    expect((await complete(spent.token)).statusCode).toBe(204);

    const late = { token: newToken(), user: await addUser() };
    await migrator(
      `INSERT INTO auth.verification (identifier, value, created_at, expires_at)
       VALUES ($1, $2, now() - interval '61 minutes', now() - interval '1 minute')`,
      [identify(late.token), `email_change:${late.user.userId}:${tenant.id}:${newAddress()}`],
    );
    const owner = await addUser();
    const foreign = await linkFor(owner);
    const stranger = await addSession(await addUser());

    const answers = [
      await complete(spent.token),
      await complete(late.token),
      await complete(newToken()),
      await complete(foreign.token, [`${SESSION}=${stranger}`]),
    ];
    const problems = answers.map((answer) => {
      const problem: Record<string, unknown> = answer.json();
      delete problem.requestId;
      return JSON.stringify([answer.statusCode, problem]);
    });
    expect(new Set(problems).size).toBe(1);
    expect(answers[0]?.statusCode).toBe(400);
    expect(answers[0]?.body).toMatch(/link is not valid/);
    expect(await emailOf(owner.userId)).not.toBe(foreign.to);
  });

  it('lets only one of two completions with the same link through', async () => {
    const user = await addUser();
    const { token } = await linkFor(user);
    const answers = await Promise.all([complete(token), complete(token)]);
    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([204, 400]);
  });

  it('fails closed if the address was taken after the link was sent', async () => {
    const user = await addUser();
    const before = user.email;
    const { to, token } = await linkFor(user);
    await withClient('app_auth', (client) =>
      client.query('INSERT INTO auth."user" (email, email_verified) VALUES ($1, true)', [to]),
    );
    const response = await complete(token);
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(to);
    expect(await emailOf(user.userId)).toBe(before);
    expect(
      await migrator(
        `SELECT 1 FROM auth.audit_event WHERE user_id = $1 AND code = 'email_changed'`,
        [user.userId],
      ),
    ).toEqual([]);
  });

  it('changes nothing for any other account', async () => {
    const user = await addUser();
    const bystander = await addUser();
    const { token: theirs } = await signedIn(bystander);
    const { token } = await linkFor(user);
    expect((await complete(token)).statusCode).toBe(204);
    expect(await emailOf(bystander.userId)).toBe(bystander.email);
    expect((await getSession(theirs)).statusCode).toBe(200);
    expect(
      await migrator(
        `SELECT 1 FROM auth.audit_event
          WHERE user_id = $1 AND code IN ('email_changed', 'sessions_revoked')`,
        [bystander.userId],
      ),
    ).toEqual([]);
  });
});
