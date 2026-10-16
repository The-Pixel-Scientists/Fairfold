// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The auth module against the test database: sessions read through
// auth.session_context() as app_api, last seen touched as app_auth, the
// session route, sign-out, auth events and their tenant copies, revoking
// sessions, and Better Auth's adapter. Sessions with times in the past are
// written as migrator, the table's owner, and committed.

import { randomUUID } from 'node:crypto';

import { createDatabase, type Kysely, type TenantId } from '@pixel-scientists/db';
import { permissionsFor } from '@pixel-scientists/domain/platform';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectionSettings, withClient } from '../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  createTestUser,
  insertRow,
  outcome,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { buildApp } from '../app.ts';
import { Secret } from '../config.ts';
import { createLogger } from '../logger.ts';
import { hashToken, newToken } from './cookies.ts';
import { copyAuthEvent, recordAuthEvent } from './events.ts';
import { createAuth, loadAuthSettings, type Auth } from './index.ts';
import { issueSession } from './sessions.ts';

const CONSOLE = 'https://console.example.org';
const PORTAL = 'https://apply.example.org';
const HOSTS = { console: 'console.example.org', portal: 'apply.example.org' } as const;

const logger = createLogger({ level: 'silent' });
let app: FastifyInstance;
let auth: Auth;
let authDb: Kysely<unknown>;

interface Member {
  tenant: TestTenant;
  userId: string;
  membershipId: string;
}

async function addMember(tenant: TestTenant, roles = ['tenant_admin']): Promise<Member> {
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles }),
  );
  return { tenant, userId, membershipId };
}

interface SessionOptions {
  app?: 'console' | 'portal';
  mfa?: string;
  /** How long ago it was created, and last seen, as intervals. */
  created?: string;
  seen?: string;
  revoked?: boolean;
}

/** Commit a session for `member` and return its token. */
async function addSession(member: Member, options: SessionOptions = {}): Promise<string> {
  const token = newToken();
  const app = options.app ?? 'console';
  await withClient('migrator', (client) =>
    client.query(
      `INSERT INTO auth.session (user_id, token_hash, app, active_tenant_id, mfa_state, expires_at,
                                 created_at, last_seen_at, reauthenticated_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '7 days', now() - $6::interval,
               now() - $7::interval, now() - $6::interval, CASE WHEN $8 THEN now() END)`,
      [
        member.userId,
        hashToken(token),
        app,
        member.tenant.id,
        options.mfa ?? (app === 'console' ? 'complete' : 'not_required'),
        options.created ?? '1 minute',
        options.seen ?? '0 minutes',
        options.revoked ?? false,
      ],
    ),
  );
  return token;
}

function cookie(app: 'console' | 'portal', token: string): string {
  return `__Host-tps_${app}_session=${token}`;
}

function readSession(token: string, target: 'console' | 'portal' = 'console') {
  return app.inject({
    url: '/api/auth/session',
    headers: { host: HOSTS[target], cookie: cookie(target, token) },
  });
}

function asMigrator<T>(query: string, values: unknown[]): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

beforeAll(async () => {
  const api = connectionSettings('app_api');
  const appAuth = connectionSettings('app_auth');
  const settings = loadAuthSettings({
    TPS_DEV: '1',
    TPS_DB_HOST: api.host,
    TPS_AUTH_SECRET: newToken(),
    TPS_DB_APP_AUTH_PASSWORD: appAuth.password,
    TPS_CONSOLE_ORIGIN: CONSOLE,
    TPS_PORTAL_ORIGIN: PORTAL,
  });
  auth = createAuth(settings, {
    database: {
      host: api.host,
      port: api.port,
      database: api.database,
      password: new Secret(api.password),
    },
    log: logger,
  });
  authDb = createDatabase<unknown>({
    host: appAuth.host,
    port: appAuth.port,
    database: appAuth.database,
    role: 'app_auth',
    password: appAuth.password,
    applicationName: 'tps-db-tests',
    maxConnections: 1,
  });
  app = await buildApp({ logger, checkDatabase: () => Promise.resolve(), auth });
});

afterAll(async () => {
  await app.close();
  await auth.close();
  await authDb.destroy();
});

describe('reading a session', { timeout: 30_000 }, () => {
  let member: Member;
  beforeAll(async () => {
    member = await addMember(await createTestTenant());
  });

  it("maps a live console session, with the membership's roles and permissions", async () => {
    const response = await readSession(await addSession(member));
    expect(response.statusCode).toBe(200);
    const body = response.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      app: 'console',
      mfa: 'complete',
      user: { id: member.userId, email: expect.stringMatching(/@example\.test$/) as unknown },
      activeMembership: {
        id: member.membershipId,
        tenant: { slug: member.tenant.slug },
        roles: ['tenant_admin'],
      },
      memberships: [{ id: member.membershipId }],
    });
    expect(body['permissions']).toEqual(permissionsFor(['tenant_admin'], 'console'));
    expect(body['recentAuthUntil']).not.toBeNull();
  });

  it('maps a session waiting for MFA, which holds nothing in any tenant', async () => {
    const response = await readSession(await addSession(member, { mfa: 'verify' }));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mfa: 'verify',
      recentAuthUntil: null,
      activeMembership: null,
      memberships: [],
      permissions: [],
    });
  });

  it('gives a portal session no staff role or permission', async () => {
    const response = await readSession(await addSession(member, { app: 'portal' }), 'portal');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      app: 'portal',
      activeMembership: null,
      permissions: [],
    });
  });

  it.each<[string, SessionOptions]>([
    ['revoked', { revoked: true }],
    ['idle past 30 minutes', { created: '2 hours', seen: '31 minutes' }],
    ['past its absolute timeout', { created: '13 hours' }],
    ['waiting for MFA for over 10 minutes', { mfa: 'verify', created: '11 minutes' }],
  ])('refuses a session %s', async (_case, options) => {
    expect((await readSession(await addSession(member, options))).statusCode).toBe(401);
  });

  it('refuses a stored hash presented as a token, in any encoding', async () => {
    const hash = hashToken(await addSession(member));
    for (const value of [hash.toString('hex'), hash.toString('base64url')]) {
      expect((await readSession(value)).statusCode).toBe(401);
    }
  });

  it("reads only the resolved app's cookie", async () => {
    const token = await addSession(member);
    const response = await app.inject({
      url: '/api/auth/session',
      headers: { host: HOSTS.portal, cookie: cookie('console', token) },
    });
    expect(response.statusCode).toBe(401);
  });

  it('updates last seen at most once a minute', async () => {
    const lastSeen = async (token: string) =>
      (
        await asMigrator<{ last_seen_at: Date }>(
          'SELECT last_seen_at FROM auth.session WHERE token_hash = $1',
          [hashToken(token)],
        )
      )[0]?.last_seen_at.getTime() ?? 0;
    const stale = await addSession(member, { created: '5 minutes', seen: '2 minutes' });
    const fresh = await addSession(member, { created: '5 minutes', seen: '10 seconds' });
    const [staleBefore, freshBefore] = [await lastSeen(stale), await lastSeen(fresh)];
    await readSession(stale);
    await readSession(fresh);
    expect(await lastSeen(stale)).toBeGreaterThan(staleBefore + 100_000);
    expect(await lastSeen(fresh)).toBe(freshBefore);
  });

  it('takes away the permissions of a module switched off for the tenant', async () => {
    const roles = ['tenant_admin', 'programme_manager'];
    const other = await addMember(await createTestTenant(), roles);
    const all = permissionsFor(roles, 'console');
    expect(all.filter((permission) => permission.startsWith('grants.'))).not.toEqual([]);
    await asMigratorIn(other.tenant.id, (client) =>
      insertRow(client, 'app.tenant_module', {
        tenant_id: other.tenant.id,
        module: 'grants',
        enabled: false,
        updated_by: other.membershipId,
      }),
    );
    const permissions = (await readSession(await addSession(other))).json<{
      permissions: string[];
    }>().permissions;
    expect(permissions).toEqual(all.filter((permission) => !permission.startsWith('grants.')));
  });
});

describe('signing out', { timeout: 30_000 }, () => {
  it('revokes the session, clears the cookie, and records the event with its tenant copy', async () => {
    const member = await addMember(await createTestTenant());
    const token = await addSession(member);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { host: HOSTS.console, origin: CONSOLE, cookie: cookie('console', token) },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toEqual([
      '__Host-tps_console_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
    ]);
    expect((await readSession(token)).statusCode).toBe(401);

    const [event] = await asMigrator<{ id: string; tenant_id: string; user_id: string }>(
      `SELECT id, tenant_id, user_id FROM auth.audit_event WHERE code = 'signed_out' AND user_id = $1`,
      [member.userId],
    );
    expect(event).toMatchObject({ tenant_id: member.tenant.id, user_id: member.userId });
    const copies = await asMigratorIn(
      member.tenant.id,
      async (client) =>
        (
          await client.query<{ action: string; actor_id: string; entity_id: string }>(
            'SELECT action, actor_id, entity_id FROM app.audit_event WHERE entity_id = $1',
            [event?.id],
          )
        ).rows,
    );
    expect(copies).toEqual([
      { action: 'platform.auth.signed_out', actor_id: member.membershipId, entity_id: event?.id },
    ]);
    const pending = await asMigrator(
      'SELECT 1 FROM auth.audit_copy_pending WHERE auth_event_id = $1',
      [event?.id],
    );
    expect(pending).toEqual([]);
  });
});

describe('auth event copies', { timeout: 30_000 }, () => {
  async function recordEvent(member: Member) {
    return authDb.transaction().execute((trx) =>
      recordAuthEvent(trx, 'sessions_revoked', {
        requestId: randomUUID(),
        userId: member.userId,
        tenant: member.tenant.id,
      }),
    );
  }

  it('are written once, however often they are retried', async () => {
    const member = await addMember(await createTestTenant());
    const event = await recordEvent(member);
    const api = connectionSettings('app_api');
    const apiDb = createDatabase<unknown>({
      ...api,
      role: 'app_api',
      applicationName: 'tps-db-tests',
    });
    try {
      const tenant = member.tenant.id as TenantId;
      await copyAuthEvent({ api: apiDb, auth: authDb, log: logger }, event, tenant);
      await copyAuthEvent({ api: apiDb, auth: authDb, log: logger }, event, tenant);
    } finally {
      await apiDb.destroy();
    }
    const count = await asMigratorIn(
      member.tenant.id,
      async (client) =>
        (
          await client.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM app.audit_event WHERE entity_id = $1',
            [event.id],
          )
        ).rows,
    );
    expect(count).toEqual([{ n: 1 }]);
    const duplicate = await asRoleIn('app_api', member.tenant.id, (client) =>
      outcome(
        client,
        `INSERT INTO app.audit_event (tenant_id, request_id, actor_kind, actor_id, action, entity_type, entity_id, changes)
         VALUES ($1, $2, 'user', $3, 'platform.auth.sessions_revoked', 'platform.auth', $4, '{}')`,
        [member.tenant.id, randomUUID(), member.membershipId, event.id],
      ),
    );
    expect(duplicate).toBe('23505');
  });

  it('leave the pending row when the copy fails', async () => {
    const member = await addMember(await createTestTenant());
    const event = await recordEvent(member);
    const closed = createDatabase<unknown>({
      ...connectionSettings('app_api'),
      role: 'app_api',
      applicationName: 'tps-db-tests',
    });
    await closed.destroy();
    await copyAuthEvent(
      { api: closed, auth: authDb, log: logger },
      event,
      member.tenant.id as TenantId,
    );
    const pending = await asMigrator(
      'SELECT 1 FROM auth.audit_copy_pending WHERE auth_event_id = $1',
      [event.id],
    );
    expect(pending).toHaveLength(1);
  });
});

describe('issuing a session', { timeout: 30_000 }, () => {
  it('replaces the old one with a new id and token, revoking it in the same transaction', async () => {
    const member = await addMember(await createTestTenant());
    const old = await addSession(member, { mfa: 'verify' });
    const token = await authDb.transaction().execute((trx) =>
      issueSession(trx, {
        userId: member.userId,
        app: 'console',
        tenantId: member.tenant.id,
        mfa: 'complete',
        reauthenticated: true,
        ip: '203.0.113.9',
        replaces: hashToken(old),
      }),
    );
    expect(token).not.toBe(old);
    expect((await readSession(old)).statusCode).toBe(401);
    const response = await readSession(token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mfa: 'complete' });
    const rows = await asMigrator<{ token_hash: Buffer }>(
      'SELECT token_hash FROM auth.session WHERE user_id = $1',
      [member.userId],
    );
    expect(rows.map((row) => row.token_hash)).toEqual(
      expect.arrayContaining([hashToken(old), hashToken(token)]),
    );
    expect(rows.some((row) => row.token_hash.toString('utf8').includes(token))).toBe(false);
  });
});

describe('revokeSessions', { timeout: 30_000 }, () => {
  it("revokes a user's live sessions in one tenant, and records it", async () => {
    const member = await addMember(await createTestTenant());
    const tokens = [await addSession(member), await addSession(member, { app: 'portal' })];
    const revoked = await auth.revokeSessions({
      userId: member.userId,
      tenant: member.tenant.id as TenantId,
      requestId: randomUUID(),
    });
    expect(revoked).toBe(2);
    expect((await readSession(tokens[0] ?? '')).statusCode).toBe(401);
    const events = await asMigrator(
      `SELECT 1 FROM auth.audit_event WHERE code = 'sessions_revoked' AND user_id = $1`,
      [member.userId],
    );
    expect(events).toHaveLength(1);
  });
});

describe("Better Auth's adapter", { timeout: 30_000 }, () => {
  it('stores a session token only as its hash, and finds a session by its token alone', async () => {
    const member = await addMember(await createTestTenant());
    const context = await auth.betterAuth.$context;
    const created = await context.internalAdapter.createSession(member.userId, false, {
      app: 'portal',
      mfaState: 'not_required',
      activeTenantId: member.tenant.id,
    });
    expect(created.token).toMatch(/^[A-Za-z0-9]{32}$/);
    const stored = await asMigrator<{ token_hash: Buffer }>(
      'SELECT token_hash FROM auth.session WHERE id = $1',
      [created.id],
    );
    expect(stored).toEqual([{ token_hash: hashToken(created.token) }]);

    const found = await context.internalAdapter.findSession(created.token);
    expect(found?.session.id).toBe(created.id);
    expect(found?.session.token).toBeUndefined();
    expect(
      await context.internalAdapter.findSession(hashToken(created.token).toString('hex')),
    ).toBeNull();
    expect((await readSession(created.token, 'portal')).statusCode).toBe(200);
  });
});
