// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Step-up, switching tenant and the session's memberships against the test
// database (ADR 0010), in the full API with every module's routes: step-up
// with password and code, as a new session, its limits, and its 5 minutes on
// a clock; switching only to the user's own active memberships in this app;
// and a walk of every route with a session waiting for MFA and with a
// complete one.

import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { authRoutes } from '@pixel-scientists/domain/auth';
import { defineRoute, type RouteContract } from '@pixel-scientists/domain/api';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { connectionSettings, withClient } from '../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  testSlug,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { buildApp } from '../app.ts';
import { Secret } from '../config.ts';
import { openDatabase, type ApiDatabase } from '../database.ts';
import { createLogger } from '../logger.ts';
import { composeModules } from '../modules.ts';
import { route } from '../routes/register.ts';
import { hashToken, newToken } from './cookies.ts';
import { createAuth, loadAuthSettings, type Auth } from './index.ts';
import { hashPassword } from './passwords.ts';
import { codeAt, stepAt } from './totp.ts';

const ORIGINS = { console: 'https://console.example.org', portal: 'https://apply.example.org' };
const HOSTS = { console: 'console.example.org', portal: 'apply.example.org' } as const;
type AppName = keyof typeof HOSTS;
const PASSWORD = 'a long synthetic passphrase';

/** A console route that needs step-up, to show the 5 minutes. */
const releaseProbe = defineRoute({
  method: 'POST',
  path: '/console/probes/step-up',
  audience: 'console',
  module: 'platform',
  permission: 'platform.members.manage',
  scope: 'tenant',
  stepUp: true,
  summary: 'Probe',
  body: z.strictObject({}),
  responses: { 204: null },
});

let app: FastifyInstance;
let auth: Auth;
let database: ApiDatabase;
let contracts: RouteContract[];

const newAddress = () => `10.${[...randomBytes(3)].join('.')}`;

function call(
  contract: Pick<RouteContract, 'method' | 'path'>,
  token: string | undefined,
  payload?: object,
  options: { app?: AppName; ip?: string } = {},
) {
  const target = options.app ?? 'console';
  const url = contract.path
    .replace(':slug', 'northfield')
    .replaceAll(/:[A-Za-z]+/g, () => randomUUID());
  return app.inject({
    method: contract.method,
    url: `/api${url}`,
    remoteAddress: options.ip ?? '192.0.2.1',
    headers: {
      host: HOSTS[target],
      origin: ORIGINS[target],
      ...(token === undefined ? {} : { cookie: `__Host-tps_${target}_session=${token}` }),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

const post = (path: string, token: string | undefined, payload?: object, options = {}) =>
  call({ method: 'POST', path }, token, payload, options);

const SESSION_COOKIE = {
  console: /^__Host-tps_console_session=([^;]*);/,
  portal: /^__Host-tps_portal_session=([^;]*);/,
} as const;

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

interface Staff {
  readonly email: string;
  readonly userId: string;
  readonly ip: string;
  /** The ids of its memberships, in the order of the tenants given. */
  readonly memberships: string[];
}

/** A new account with a password, and a membership with `roles` in each tenant given. */
async function addUser(tenants: TestTenant[], roles = ['tenant_admin']): Promise<Staff> {
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
  const memberships = [];
  for (const tenant of tenants) memberships.push(await addMembership(tenant, userId, roles));
  return { email, userId, ip: newAddress(), memberships };
}

function addMembership(tenant: TestTenant, userId: string, roles: string[], status = 'active') {
  return asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles, status }),
  );
}

async function signIn(tenant: TestTenant, user: Staff, target: AppName = 'console') {
  const response = await post(
    `/auth/tenants/${tenant.slug}/sign-in`,
    undefined,
    { email: user.email, password: PASSWORD },
    { app: target, ip: user.ip },
  );
  expect(response.statusCode).toBe(200);
  return tokenOf(response, target) ?? '';
}

/** Sign in at `tenant` and set up an authenticator: a complete session, its secret and the step of the code it used. */
async function signedIn(tenant: TestTenant, user: Staff) {
  const pending = await signIn(tenant, user);
  const key = (await post('/auth/totp/enrol', pending)).json<{ key: string }>().key;
  const secret = fromBase32(key);
  const step = await freshStep();
  const code = codeAt(secret, step - 1);
  const confirmed = await post('/auth/totp/confirm', pending, { code }, { ip: user.ip });
  expect(confirmed.statusCode).toBe(200);
  return { token: tokenOf(confirmed) ?? '', secret, step };
}

const stepUp = (token: string, code: string, user: Staff, password = PASSWORD) =>
  post('/auth/step-up', token, { password, code }, { ip: user.ip });

const getSession = (token: string, target: AppName = 'console') =>
  call({ method: 'GET', path: '/auth/session' }, token, undefined, { app: target });

async function events(userId: string, code: string) {
  return migrator<{ tenant_id: string; reason: string | null }>(
    'SELECT tenant_id, reason FROM auth.audit_event WHERE user_id = $1 AND code = $2',
    [userId, code],
  );
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
  const connection = {
    host: api.host,
    port: api.port,
    database: api.database,
    password: new Secret(api.password),
  };
  auth = createAuth(settings, {
    database: connection,
    log: logger,
    commonPasswords: new Set(['synthetic common password']),
  });
  database = openDatabase(connection, logger);
  const modules = composeModules({ publicTenants: database.publicTenants });
  contracts = [...Object.values(authRoutes), ...modules.routes.map((r) => r.contract)];
  app = await buildApp({
    logger,
    checkDatabase: () => Promise.resolve(),
    auth,
    inTenant: database.inTenant,
    routes: [...modules.routes, route(releaseProbe, () => Promise.resolve(undefined))],
    resolvers: modules.resolvers,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await app.close();
  await auth.close();
  await database.close();
});

describe('step-up', { timeout: 120_000 }, () => {
  let tenant: TestTenant;
  beforeAll(async () => {
    tenant = await createTestTenant();
  });

  it('takes password and code together, then lets a step-up route through for 5 minutes', async () => {
    const user = await addUser([tenant]);
    const { token, secret, step } = await signedIn(tenant, user);
    // Sign-in counts as recent too, so start from a stale re-authentication.
    await migrator(
      `UPDATE auth.session SET reauthenticated_at = now() - interval '1 hour'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.userId],
    );
    expect((await call(releaseProbe, token, {})).statusCode).toBe(403);

    const response = await stepUp(token, codeAt(secret, step), user);
    expect(response.statusCode).toBe(200);
    const next = tokenOf(response) ?? '';
    expect(next).not.toBe('');
    expect(next).not.toBe(token);
    expect((await getSession(token)).statusCode).toBe(401);
    expect((await call(releaseProbe, token, {})).statusCode).toBe(401);
    const until = Date.parse(response.json<{ recentAuthUntil: string }>().recentAuthUntil);
    expect(Math.abs(until - (Date.now() + 5 * 60_000))).toBeLessThan(5000);
    expect(await events(user.userId, 'step_up_completed')).toEqual([
      { tenant_id: tenant.id, reason: null },
    ]);
    expect((await call(releaseProbe, next, {})).statusCode).toBe(204);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 4 * 60_000 + 50_000 });
    expect((await call(releaseProbe, next, {})).statusCode).toBe(204);
    vi.setSystemTime(Date.now() + 15_000);
    expect((await call(releaseProbe, next, {})).statusCode).toBe(403);
  });

  it('keeps the absolute end of the session it replaces', async () => {
    const user = await addUser([tenant]);
    const { token, secret, step } = await signedIn(tenant, user);
    const next = tokenOf(await stepUp(token, codeAt(secret, step), user)) ?? '';
    const ends = await migrator<{ expires_at: Date }>(
      'SELECT expires_at FROM auth.session WHERE token_hash = ANY($1) ORDER BY created_at',
      [[hashToken(token), hashToken(next)]],
    );
    expect(ends).toHaveLength(2);
    expect(ends[1]?.expires_at).toEqual(ends[0]?.expires_at);
  });

  it('accepts a code once, and never spends one on a wrong password', async () => {
    const user = await addUser([tenant]);
    const signed = await signedIn(tenant, user);
    const { secret, step } = signed;
    let { token } = signed;
    // The code that confirmed the authenticator, then one used at step-up, are spent.
    expect((await stepUp(token, codeAt(secret, step - 1), user)).statusCode).toBe(401);
    const first = await stepUp(token, codeAt(secret, step), user);
    expect(first.statusCode).toBe(200);
    token = tokenOf(first) ?? '';
    expect((await stepUp(token, codeAt(secret, step), user)).statusCode).toBe(401);
    const next = codeAt(secret, step + 1);
    expect((await stepUp(token, next, user, 'not the password at all')).statusCode).toBe(401);
    expect((await stepUp(token, next, user)).statusCode).toBe(200);
    expect(await events(user.userId, 'mfa_code_failed')).toHaveLength(2);
    expect(await events(user.userId, 'sign_in_failed')).toEqual([
      { tenant_id: tenant.id, reason: 'step_up' },
    ]);
  });

  it('counts failures like sign-in failures, delaying after 5', async () => {
    const user = await addUser([tenant]);
    const { token } = await signedIn(tenant, user);
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await stepUp(token, '000000', user, 'not the password at all')).statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('refuses a portal session', async () => {
    const user = await addUser([]);
    const portal = await signIn(tenant, user, 'portal');
    const response = await post(
      '/auth/step-up',
      portal,
      { password: PASSWORD, code: '000000' },
      { app: 'portal', ip: user.ip },
    );
    expect(response.statusCode).toBe(403);
  });
});

describe('switching tenant', { timeout: 120_000 }, () => {
  let home: TestTenant;
  let other: TestTenant;
  let user: Staff;
  let token: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const [first, second, suspended, portalOnly] = await Promise.all(
      [1, 2, 3, 4].map(() => createTestTenant()),
    );
    home = first as TestTenant;
    other = second as TestTenant;
    user = await addUser([home]);
    ids['home'] = user.memberships[0] ?? '';
    ids['other'] = await addMembership(other, user.userId, ['tenant_admin']);
    ids['suspended'] = await addMembership(
      suspended as TestTenant,
      user.userId,
      ['tenant_admin'],
      'suspended',
    );
    ids['portal'] = await addMembership(portalOnly as TestTenant, user.userId, ['applicant']);
    ids['stranger'] = (await addUser([other])).memberships[0] ?? '';
    ({ token } = await signedIn(home, user));
  }, 60_000);

  it("lists the user's active memberships in this app, and no others", async () => {
    const listed = (await getSession(token)).json<{ memberships: { id: string }[] }>().memberships;
    expect(listed.map(({ id }) => id).sort()).toEqual([ids['home'], ids['other']].sort());
  });

  it('gives 404 for a suspended membership, one in the other app, another user’s, or none', async () => {
    for (const membershipId of [ids['suspended'], ids['portal'], ids['stranger'], randomUUID()]) {
      expect((await post('/auth/switch-tenant', token, { membershipId })).statusCode).toBe(404);
    }
  });

  it('switches to another membership as a new session, still complete, and records it there', async () => {
    const response = await post('/auth/switch-tenant', token, { membershipId: ids['other'] });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mfa: 'complete',
      activeMembership: { id: ids['other'], tenant: { slug: other.slug } },
    });
    const next = tokenOf(response) ?? '';
    expect(next).not.toBe(token);
    expect((await getSession(token)).statusCode).toBe(401);
    expect((await getSession(next)).statusCode).toBe(200);
    const [event] = await migrator<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM auth.audit_event WHERE user_id = $1 AND code = 'tenant_switched'`,
      [user.userId],
    );
    expect(event?.tenant_id).toBe(other.id);
    const copied = await asMigratorIn(other.id, async (client) =>
      (
        await client.query<{ action: string }>(
          'SELECT action FROM app.audit_event WHERE entity_id = $1',
          [event?.id],
        )
      ).rows.map((row) => row.action),
    );
    expect(copied).toEqual(['platform.auth.tenant_switched']);
    token = next;
  });
});

describe('every route', { timeout: 120_000 }, () => {
  /** What a session waiting for MFA may use: the MFA routes, the session and sign-out. */
  const waitingMay = new Set([
    '/auth/totp/enrol',
    '/auth/totp/confirm',
    '/auth/totp/verify',
    '/auth/session',
    '/auth/sign-out',
  ]);

  /** The registered routes that read a session. */
  const withSession = () =>
    contracts.filter(
      (contract) =>
        contract.audience !== 'public' &&
        !(contract.audience === 'auth' && contract.session === 'none') &&
        app.hasRoute({ method: contract.method, url: `/api${contract.path}` }),
    );

  it('answers 401 to a session waiting for MFA, but for the MFA routes, the session and sign-out', async () => {
    const tenant = await createTestTenant();
    const user = await addUser([tenant]);
    const pending = await signIn(tenant, user);
    const walked = [...withSession(), releaseProbe].filter((c) => !waitingMay.has(c.path));
    expect(walked.map((contract) => contract.path)).toEqual(
      expect.arrayContaining(['/auth/step-up', '/auth/switch-tenant', '/console/settings']),
    );
    const reached: string[] = [];
    for (const contract of walked) {
      const response = await call(contract, pending, contract.method === 'GET' ? undefined : {});
      if (response.statusCode !== 401) reached.push(`${contract.method} ${contract.path}`);
    }
    expect(reached).toEqual([]);
    expect((await getSession(pending)).json()).toMatchObject({ mfa: 'enrol' });
  });

  it('answers 403 to a complete session on the TOTP routes', async () => {
    const tenant = await createTestTenant();
    const { token } = await signedIn(tenant, await addUser([tenant]));
    const totp = withSession().filter((contract) => contract.path.startsWith('/auth/totp/'));
    expect(totp).toHaveLength(3);
    for (const contract of totp) {
      expect((await call(contract, token, { code: '000000' })).statusCode).toBe(403);
    }
  });
});
