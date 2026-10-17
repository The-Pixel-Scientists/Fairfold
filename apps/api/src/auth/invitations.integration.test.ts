// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Invitations and membership sessions against the test database (ADR 0010):
// issuing a link whose token is kept only as a hash, by a member as app_api
// and by the operator as app_worker; accepting it in a complete console
// session at the invitation's tenant, once, and every refusal answering the
// same; and revoking a member's sessions in one tenant only. Emails go to a
// fake sender.

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import {
  connectionSettings,
  databaseSettings,
  withClient,
} from '../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  testSlug,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { buildApp } from '../app.ts';
import { Secret } from '../config.ts';
import type { Email, SendResult, Sender } from '../email/sender.ts';
import { createLogger } from '../logger.ts';
import { hashToken, newToken } from './cookies.ts';
import {
  createAuth,
  createOperatorInvitation,
  loadAuthSettings,
  revokeInvitation,
  type Auth,
} from './index.ts';

const ORIGIN = 'https://console.example.org';
const HOST = 'console.example.org';

let app: FastifyInstance;
let auth: Auth;
const api = createDatabase<unknown>(databaseSettings('app_api', 2));
const worker = createDatabase<unknown>(databaseSettings('app_worker', 1));
let tenant: TestTenant;
let other: TestTenant;
let admin: string;
const sent: Email[] = [];
let result: SendResult = { sent: true };
const sender: Sender = {
  send(email) {
    sent.push(email);
    return Promise.resolve(result);
  },
};

const inTenant = <T>(target: TestTenant, work: Parameters<typeof withTenant<unknown, T>>[2]) =>
  withTenant(api, trustedTenantId(target.id), work);

function migrator<T>(query: string, values: unknown[] = []): Promise<T[]> {
  return withClient('migrator', async (client) => (await client.query(query, values)).rows as T[]);
}

/** The rows of `query`, as migrator in `target`. */
function rowsIn<T = Record<string, unknown>>(
  target: TestTenant,
  query: string,
  values: unknown[] = [],
): Promise<T[]> {
  return asMigratorIn(target.id, async (client) => (await client.query(query, values)).rows as T[]);
}

/** A verified account, and its id. */
async function addAccount(email = `${testSlug()}@example.test`) {
  const [row] = await withClient(
    'app_auth',
    async (client) =>
      (
        await client.query<{ id: string }>(
          'INSERT INTO auth."user" (email, email_verified) VALUES ($1, true) RETURNING id',
          [email],
        )
      ).rows,
  );
  return { email, userId: row?.id ?? '' };
}

function addMembership(target: TestTenant, userId: string, roles: string[], status = 'active') {
  return asMigratorIn(target.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: target.id, user_id: userId, roles, status }),
  );
}

/** A live session of `userId` active in `target`, and its token. */
async function sessionFor(
  userId: string,
  target: TestTenant,
  options: { mfa?: string; app?: string } = {},
) {
  const token = newToken();
  await migrator(
    `INSERT INTO auth.session (user_id, token_hash, app, active_tenant_id, mfa_state, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
    [userId, hashToken(token), options.app ?? 'console', target.id, options.mfa ?? 'complete'],
  );
  return token;
}

/** Invite `email` to `target` as its admin, and return the invitation and the token emailed. */
async function invite(target: TestTenant, by: string, email: string, roles = ['reviewer']) {
  const actor = { kind: 'user', membershipId: by, requestId: randomUUID() } as const;
  const invitation = await inTenant(target, (trx) =>
    auth.createInvitation(trx, actor, { email, roles }),
  );
  return { invitation, token: tokenIn(sent.at(-1)) };
}

const tokenIn = (email: Email | undefined) =>
  /#token=([A-Za-z0-9_-]+)$/m.exec(email?.text ?? '')?.[1] ?? '';

function accept(token: string, session: string, origin = ORIGIN) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/invitations/accept',
    remoteAddress: '192.0.2.1',
    headers: { host: HOST, origin, cookie: `__Host-tps_console_session=${session}` },
    payload: { token },
  });
}

const cookieOf = (response: LightMyRequestResponse) =>
  /^__Host-tps_console_session=([^;]*);/.exec(String(response.headers['set-cookie']))?.[1];

const statusOf = async (id: string, target = tenant) =>
  (
    await rowsIn<{ status: string }>(target, 'SELECT status FROM app.invitation WHERE id = $1', [
      id,
    ])
  )[0]?.status;

beforeAll(async () => {
  const settings = connectionSettings('app_api');
  auth = createAuth(
    loadAuthSettings({
      TPS_DEV: '1',
      TPS_DB_HOST: settings.host,
      TPS_AUTH_SECRET: newToken(),
      TPS_DB_APP_AUTH_PASSWORD: connectionSettings('app_auth').password,
      TPS_CONSOLE_ORIGIN: ORIGIN,
      TPS_PORTAL_ORIGIN: 'https://apply.example.org',
    }),
    {
      database: {
        host: settings.host,
        port: settings.port,
        database: settings.database,
        password: new Secret(settings.password),
      },
      log: createLogger({ level: 'silent' }),
      sender,
      commonPasswords: new Set(['synthetic common password']),
    },
  );
  app = await buildApp({
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => Promise.resolve(),
    auth,
  });
  [tenant, other] = [await createTestTenant(), await createTestTenant()];
  admin = await addMembership(tenant, (await addAccount()).userId, ['tenant_admin']);
});

afterAll(async () => {
  await app.close();
  await auth.close();
  await Promise.all([api.destroy(), worker.destroy()]);
});

describe('createInvitation', { timeout: 60_000 }, () => {
  it("emails a 7-day link to the tenant's console page, and keeps only the token's hash", async () => {
    const email = `${testSlug()}@example.test`;
    const { invitation, token } = await invite(tenant, admin, email, [
      'programme_manager',
      'reviewer',
    ]);
    expect(sent.at(-1)?.to).toBe(email);
    expect(sent.at(-1)?.text).toContain(`${ORIGIN}/${tenant.slug}/invitation#token=${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invitation).toMatchObject({ email, roles: ['programme_manager', 'reviewer'] });

    const [row] = await rowsIn<{ hash: Buffer; expires: Date; created_by: string; text: string }>(
      tenant,
      `SELECT token_hash AS hash, expires_at AS expires, created_by, i::text AS text
             FROM app.invitation AS i WHERE id = $1`,
      [invitation.id],
    );
    expect(row?.hash).toEqual(hashToken(token));
    expect(row?.created_by).toBe(admin);
    expect(row?.expires.toISOString()).toBe(invitation.expiresAt);
    expect(Math.abs(Date.parse(invitation.expiresAt) - Date.now() - 7 * 86_400_000)).toBeLessThan(
      60_000,
    );

    const stored = await asMigratorIn(
      tenant.id,
      async (client) =>
        (
          await client.query<{ text: string }>(
            `SELECT i::text AS text FROM app.invitation AS i
           UNION ALL SELECT e::text FROM app.audit_event AS e
           UNION ALL SELECT a::text FROM auth.audit_event AS a`,
          )
        ).rows,
    );
    expect(stored.filter(({ text }) => text.includes(token))).toEqual([]);
    const events = await rowsIn(
      tenant,
      `SELECT actor_id, changes FROM app.audit_event
            WHERE action = 'platform.invitation.sent' AND entity_id = $1`,
      [invitation.id],
    );
    expect(events).toEqual([
      {
        actor_id: admin,
        changes: {
          'app.invitation.email': {},
          'app.invitation.roles': { after: ['programme_manager', 'reviewer'] },
        },
      },
    ]);
  });

  it('refuses an address already in the team or already invited, but replaces an expired invitation', async () => {
    const member = await addAccount();
    await addMembership(tenant, member.userId, ['reviewer'], 'suspended');
    await expect(invite(tenant, admin, member.email)).rejects.toMatchObject({ status: 409 });

    const email = `${testSlug()}@example.test`;
    const { invitation } = await invite(tenant, admin, email);
    await expect(invite(tenant, admin, email)).rejects.toMatchObject({ status: 409 });
    await asMigratorIn(tenant.id, (client) =>
      client.query(
        `UPDATE app.invitation SET created_at = now() - interval '8 days',
                expires_at = now() - interval '8 days' + interval '168 hours' WHERE id = $1`,
        [invitation.id],
      ),
    );
    await invite(tenant, admin, email);
    expect(await statusOf(invitation.id)).toBe('revoked');
  });

  it('keeps nothing when the email cannot be sent', async () => {
    const email = `${testSlug()}@example.test`;
    result = { sent: false, code: 'rejected' };
    try {
      await expect(invite(tenant, admin, email)).rejects.toMatchObject({ status: 503 });
    } finally {
      result = { sent: true };
    }
    const rows = await rowsIn(tenant, 'SELECT 1 FROM app.invitation WHERE email = $1', [email]);
    expect(rows).toEqual([]);
  });

  it("lets the operator invite a new tenant's first admin as app_worker", async () => {
    const fresh = await createTestTenant();
    const email = `${testSlug()}@example.test`;
    const requestId = randomUUID();
    const invitation = await withTenant(worker, trustedTenantId(fresh.id), (trx) =>
      createOperatorInvitation(
        { consoleBase: ORIGIN, sender },
        trx,
        { kind: 'operator', requestId, tenant: { slug: fresh.slug, name: 'Test tenant' } },
        { email, roles: ['tenant_admin'] },
      ),
    );
    const token = tokenIn(sent.at(-1));
    expect(sent.at(-1)?.text).toContain(`${ORIGIN}/${fresh.slug}/invitation#token=`);

    const account = await addAccount(email);
    const response = await accept(token, await sessionFor(account.userId, fresh));
    expect(response.statusCode).toBe(200);
    const rows = await rowsIn(
      fresh,
      `SELECT i.created_by AS invited_by, m.created_by AS member_by, m.roles
             FROM app.invitation AS i JOIN app.membership AS m ON m.id = i.accepted_membership_id
            WHERE i.id = $1`,
      [invitation.id],
    );
    expect(rows).toEqual([{ invited_by: null, member_by: null, roles: ['tenant_admin'] }]);
  });
});

describe('acceptInvitation', { timeout: 60_000 }, () => {
  it('makes the membership, marks the invitation, records it all and rotates the session', async () => {
    const person = await addAccount();
    const { invitation, token } = await invite(tenant, admin, person.email, ['reviewer']);
    const session = await sessionFor(person.userId, tenant);

    const response = await accept(token, session);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { id: person.userId, email: person.email },
      activeMembership: { tenant: { slug: tenant.slug }, roles: ['reviewer'] },
    });
    const next = cookieOf(response) ?? '';
    expect(next).not.toBe('');
    expect(next).not.toBe(session);
    const old = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { host: HOST, cookie: `__Host-tps_console_session=${session}` },
    });
    expect(old.statusCode).toBe(401);

    const [row] = await rowsIn<{ status: string; membership: string; by: string; roles: string[] }>(
      tenant,
      `SELECT i.status, m.id AS membership, m.created_by AS by, m.roles
             FROM app.invitation AS i JOIN app.membership AS m ON m.id = i.accepted_membership_id
            WHERE i.id = $1 AND m.user_id = $2`,
      [invitation.id, person.userId],
    );
    expect(row).toMatchObject({ status: 'accepted', by: admin, roles: ['reviewer'] });
    const actions = await rowsIn<{ action: string }>(
      tenant,
      'SELECT action FROM app.audit_event WHERE actor_id = $1 ORDER BY action',
      [row?.membership],
    );
    expect(actions.map(({ action }) => action)).toEqual([
      'party.person.created',
      'platform.auth.invitation_accepted',
      'platform.membership.created',
    ]);
    expect(
      await migrator('SELECT tenant_id FROM auth.audit_event WHERE user_id = $1 AND code = $2', [
        person.userId,
        'invitation_accepted',
      ]),
    ).toEqual([{ tenant_id: tenant.id }]);
  });

  it('reinstates a removed membership with the invited roles', async () => {
    const person = await addAccount();
    const membership = await addMembership(tenant, person.userId, ['applicant'], 'removed');
    const { token } = await invite(tenant, admin, person.email, ['programme_manager']);
    expect((await accept(token, await sessionFor(person.userId, tenant))).statusCode).toBe(200);
    const rows = await rowsIn(tenant, 'SELECT status, roles FROM app.membership WHERE id = $1', [
      membership,
    ]);
    expect(rows).toEqual([{ status: 'active', roles: ['programme_manager'] }]);
  });

  it('answers every refusal with the same 404 and changes nothing', async () => {
    const person = await addAccount();
    const session = await sessionFor(person.userId, tenant);
    const refused = async (token: string, id: string, target = tenant) => {
      const response = await accept(token, session);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ status: 404 });
      expect(await statusOf(id, target)).not.toBe('accepted');
    };

    const expired = await invite(tenant, admin, person.email);
    await asMigratorIn(tenant.id, (client) =>
      client.query(
        `UPDATE app.invitation SET created_at = now() - interval '8 days',
                expires_at = now() - interval '8 days' + interval '168 hours' WHERE id = $1`,
        [expired.invitation.id],
      ),
    );
    await refused(expired.token, expired.invitation.id);

    const revoked = await invite(tenant, admin, person.email);
    const actor = { kind: 'user', membershipId: admin, requestId: randomUUID() } as const;
    expect(
      await inTenant(tenant, (trx) => revokeInvitation(trx, actor, revoked.invitation.id)),
    ).toBe(true);
    await refused(revoked.token, revoked.invitation.id);

    const otherAdmin = await addMembership(other, (await addAccount()).userId, ['tenant_admin']);
    const elsewhere = await invite(other, otherAdmin, person.email);
    await refused(elsewhere.token, elsewhere.invitation.id, other);

    const someoneElse = await invite(tenant, admin, `${testSlug()}@example.test`);
    await refused(someoneElse.token, someoneElse.invitation.id);

    await refused(newToken(), someoneElse.invitation.id);
  });

  it('refuses a session waiting for MFA, a portal session and a suspended member', async () => {
    const person = await addAccount();
    const { invitation, token } = await invite(tenant, admin, person.email);
    const waiting = await sessionFor(person.userId, tenant, { mfa: 'verify' });
    expect((await accept(token, waiting)).statusCode).toBe(401);
    const portal = await sessionFor(person.userId, tenant, { app: 'portal', mfa: 'not_required' });
    const fromPortal = await app.inject({
      method: 'POST',
      url: '/api/auth/invitations/accept',
      headers: {
        host: 'apply.example.org',
        origin: 'https://apply.example.org',
        cookie: `__Host-tps_portal_session=${portal}`,
      },
      payload: { token },
    });
    expect(fromPortal.statusCode).toBe(404);
    await addMembership(tenant, person.userId, ['reviewer'], 'suspended');
    expect((await accept(token, await sessionFor(person.userId, tenant))).statusCode).toBe(404);
    expect(await statusOf(invitation.id)).toBe('pending');
  });

  it('lets exactly one of two acceptances at once win', async () => {
    const person = await addAccount();
    const { token } = await invite(tenant, admin, person.email);
    const [first, second] = [
      await sessionFor(person.userId, tenant),
      await sessionFor(person.userId, tenant),
    ];
    const codes = (await Promise.all([accept(token, first), accept(token, second)])).map(
      (response) => response.statusCode,
    );
    expect(codes.sort()).toEqual([200, 404]);
  });
});

describe('revokeSessionsForMembership', { timeout: 60_000 }, () => {
  it("revokes the member's sessions in this tenant only, and records it", async () => {
    const person = await addAccount();
    const membership = await addMembership(tenant, person.userId, ['reviewer']);
    await addMembership(other, person.userId, ['reviewer']);
    await sessionFor(person.userId, tenant);
    await sessionFor(person.userId, tenant);
    const there = await sessionFor(person.userId, other);
    const requestId = randomUUID();

    const count = await inTenant(tenant, (trx) =>
      auth.revokeSessionsForMembership(trx, {
        membershipId: membership,
        tenant: trustedTenantId(tenant.id),
        requestId,
        reason: 'membership_suspended',
      }),
    );
    expect(count).toBe(2);
    const live = await migrator<{ token_hash: Buffer }>(
      'SELECT token_hash FROM auth.session WHERE user_id = $1 AND revoked_at IS NULL',
      [person.userId],
    );
    expect(live.map(({ token_hash }) => token_hash)).toEqual([hashToken(there)]);
    expect(
      await migrator('SELECT tenant_id, reason FROM auth.audit_event WHERE request_id = $1', [
        requestId,
      ]),
    ).toEqual([{ tenant_id: tenant.id, reason: 'membership_suspended' }]);
    const copies = await rowsIn(
      tenant,
      'SELECT actor_id FROM app.audit_event WHERE request_id = $1',
      [requestId],
    );
    expect(copies).toEqual([{ actor_id: membership }]);
  });

  it("refuses another tenant's membership", async () => {
    const elsewhere = await addMembership(other, (await addAccount()).userId, ['reviewer']);
    await expect(
      inTenant(tenant, (trx) =>
        auth.revokeSessionsForMembership(trx, {
          membershipId: elsewhere,
          tenant: trustedTenantId(tenant.id),
          requestId: randomUUID(),
          reason: 'membership_removed',
        }),
      ),
    ).rejects.toThrow('not in this tenant');
  });
});
