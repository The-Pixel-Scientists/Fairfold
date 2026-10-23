// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The team routes through the whole API against the test database (ADR 0010):
// the policy, step-up, row-level security, the real auth module for
// invitations and sessions, and the audit events. The session itself is a
// stand-in; the sessions the changes revoke are real rows.

import { randomBytes, randomUUID } from 'node:crypto';

import { roles, type Role } from '@pixel-scientists/domain/platform';
import type { Invitation, Member, Team } from '@pixel-scientists/domain/platform/team';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectionSettings, withClient } from '../../../../../packages/db/test/connect.ts';
import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  testSlug,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { expectLooksMissing, testAuth, testSession } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { createAuth, loadAuthSettings, type Auth } from '../../auth/index.ts';
import { Secret } from '../../config.ts';
import { openDatabase, type ApiDatabase } from '../../database.ts';
import type { Email, Sender } from '../../email/sender.ts';
import { createLogger } from '../../logger.ts';
import { composeModules } from '../../modules.ts';

const STEP_UP = 'Confirm it is you again, then try again.';

interface Person {
  readonly userId: string;
  readonly membershipId: string;
  readonly tenant: TestTenant;
  readonly app: 'console' | 'portal';
}

let api: FastifyInstance;
let auth: Auth;
let database: ApiDatabase;
const stand = testAuth();
const sent: Email[] = [];
let mailWorks = true;
const sender: Sender = {
  send(email) {
    sent.push(email);
    return Promise.resolve(mailWorks ? { sent: true } : { sent: false, code: 'rejected' });
  },
};

let tenant: TestTenant;
let other: TestTenant;
let admin: Person;
let otherAdmin: Person;

async function add(
  target: TestTenant,
  role: string,
  options: { name?: [string, string]; email?: string; status?: string } = {},
): Promise<Person> {
  const userId = await createTestUser();
  const { app } = roles[role as Role];
  const membershipId = await asMigratorIn(target.id, async (client) => {
    const id = await insertRow(client, 'app.membership', {
      tenant_id: target.id,
      user_id: userId,
      roles: [role],
      status: options.status ?? 'active',
    });
    if (options.name !== undefined || options.email !== undefined) {
      await addPerson(client, target, {
        user_id: userId,
        ...(options.name && { given_name: options.name[0], family_name: options.name[1] }),
        ...(options.email && { email: options.email }),
      });
    }
    return id;
  });
  return { userId, membershipId, tenant: target, app };
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** A request as `who`, signed in a minute ago unless `fresh` is false. */
function call(
  who: Person | undefined,
  method: Method,
  path: string,
  payload?: object,
  fresh = true,
): Promise<LightMyRequestResponse> {
  const headers =
    who === undefined
      ? {}
      : stand.as({
          app: who.app,
          session: testSession({
            app: who.app,
            userId: who.userId,
            tenant: who.tenant.id,
            recentAuthAt: fresh ? new Date(Date.now() - 60_000) : null,
          }),
        });
  return api.inject({
    method,
    url: `/api/console/team${path}`,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

const team = async (who: Person): Promise<Team> => (await call(who, 'GET', '')).json<Team>();

const rows = <T>(target: TestTenant, query: string, values: unknown[] = []): Promise<T[]> =>
  asMigratorIn(target.id, async (client) => (await client.query(query, values)).rows as T[]);

const state = async (person: Person) =>
  (
    await rows<{ status: string; roles: string[] }>(
      person.tenant,
      'SELECT status, roles FROM app.membership WHERE id = $1',
      [person.membershipId],
    )
  )[0];

interface AuditRow {
  actor_id: string;
  entity_id: string;
  changes: Record<string, { before?: unknown; after?: unknown }>;
}

const events = (target: TestTenant, action: string, entityId: string) =>
  rows<AuditRow>(
    target,
    'SELECT actor_id, entity_id, changes FROM app.audit_event WHERE action = $1 AND entity_id = $2',
    [action, entityId],
  );

/**
 * Whether the tenant's audit log holds the copy of the member's session
 * revocation, and whether any copy is still waiting for a replay.
 */
async function revocationCopy(person: Person) {
  const [copied, waiting] = await Promise.all([
    rows<object>(
      person.tenant,
      "SELECT 1 FROM app.audit_event WHERE action = 'platform.auth.sessions_revoked' AND actor_id = $1",
      [person.membershipId],
    ),
    withClient(
      'migrator',
      async (client) =>
        (
          await client.query<object>(
            `SELECT 1 FROM auth.audit_copy_pending p
             JOIN auth.audit_event e ON e.id = p.auth_event_id
            WHERE e.user_id = $1 AND e.code = 'sessions_revoked'`,
            [person.userId],
          )
        ).rows,
    ),
  ]);
  return { copied: copied.length, waiting: waiting.length };
}

/** Run a change that revokes sessions and check it was quick and its audit copy landed. */
async function expectRevocationAudited(person: Person, change: () => Promise<unknown>) {
  const started = Date.now();
  await change();
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(await revocationCopy(person)).toEqual({ copied: 1, waiting: 0 });
}

/** A live console session of `person` in their tenant. Resolves to whether it was revoked. */
async function liveSession(
  person: Person,
  activeIn = person.tenant,
): Promise<() => Promise<boolean>> {
  const hash = randomBytes(32);
  await withClient('migrator', (client) =>
    client.query(
      `INSERT INTO auth.session (user_id, token_hash, app, active_tenant_id, mfa_state, expires_at)
       VALUES ($1, $2, 'console', $3, 'complete', now() + interval '1 hour')`,
      [person.userId, hash, activeIn.id],
    ),
  );
  return () =>
    withClient('migrator', async (client) => {
      const { rows: found } = await client.query<{ revoked: boolean }>(
        'SELECT revoked_at IS NOT NULL AS revoked FROM auth.session WHERE token_hash = $1',
        [hash],
      );
      return found[0]?.revoked === true;
    });
}

beforeAll(async () => {
  const appApi = connectionSettings('app_api');
  const connection = {
    host: appApi.host,
    port: appApi.port,
    database: appApi.database,
    password: new Secret(appApi.password),
  };
  const logger = createLogger({ level: 'silent' });
  auth = createAuth(
    loadAuthSettings({
      TPS_DEV: '1',
      TPS_DB_HOST: appApi.host,
      TPS_AUTH_SECRET: randomBytes(32).toString('base64url'),
      TPS_DB_APP_AUTH_PASSWORD: connectionSettings('app_auth').password,
      TPS_CONSOLE_ORIGIN: 'https://console.example.org',
      TPS_PORTAL_ORIGIN: 'https://apply.example.org',
    }),
    { database: connection, log: logger, sender, commonPasswords: new Set(['synthetic']) },
  );
  database = openDatabase(connection, logger);
  api = await buildApp({
    logger,
    checkDatabase: () => Promise.resolve(),
    inTenant: database.inTenant,
    auth: stand.module,
    ...composeModules({ publicTenants: database.publicTenants, auth }),
  });
  [tenant, other] = await Promise.all([createTestTenant(), createTestTenant()]);
  admin = await add(tenant, 'tenant_admin', {
    name: ['Ada', 'Lovelace'],
    email: 'ada@example.test',
  });
  otherAdmin = await add(other, 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await api.close();
  await auth.close();
  await database.close();
});

describe('who may use the team routes', { timeout: 60_000 }, () => {
  const id = randomUUID();
  const requests: [Method, string, object?][] = [
    ['GET', ''],
    ['POST', '/invitations', { email: 'a@example.test', roles: ['reviewer'] }],
    ['DELETE', `/invitations/${id}`],
    ['PUT', `/members/${id}/roles`, { roles: ['reviewer'] }],
    ['POST', `/members/${id}/suspend`],
    ['POST', `/members/${id}/reinstate`],
    ['DELETE', `/members/${id}`],
  ];

  it('lets an administrator in and keeps every other role out', async () => {
    const outsiders = [
      await add(tenant, 'programme_manager'),
      await add(tenant, 'reviewer'),
      await add(tenant, 'applicant'),
    ];
    for (const [method, path, body] of requests) {
      expect((await call(undefined, method, path, body)).statusCode, path).toBe(401);
      for (const outsider of outsiders) {
        const response = await call(outsider, method, path, body);
        expect(response.statusCode, `${method} ${path}`).toBe(403);
      }
      const allowed = await call(admin, method, path, body);
      expect([401, 403], `${method} ${path}`).not.toContain(allowed.statusCode);
    }
  });

  it('asks for a recent sign-in on every change, and not to read the team', async () => {
    expect((await call(admin, 'GET', '', undefined, false)).statusCode).toBe(200);
    for (const [method, path, body] of requests.slice(1)) {
      const response = await call(admin, method, path, body, false);
      expect(response.statusCode, path).toBe(403);
      expect(response.json<{ detail: string }>().detail).toBe(STEP_UP);
    }
  });
});

describe('listing the team', { timeout: 60_000 }, () => {
  it('shows names and addresses from party, roles and status, and no applicant or removed member', async () => {
    const lister = await add(tenant, 'tenant_admin', {
      name: ['Grace', 'Hopper'],
      email: 'grace@example.test',
    });
    const unnamed = await add(tenant, 'reviewer', { email: 'nameless@example.test' });
    const noPerson = await add(tenant, 'programme_manager', { status: 'suspended' });
    const applicant = await add(tenant, 'applicant');
    const removed = await add(tenant, 'reviewer', { status: 'removed' });

    const { members } = await team(lister);
    const byId = new Map(members.map((member) => [member.id, member]));
    expect(byId.get(lister.membershipId)).toEqual({
      id: lister.membershipId,
      name: 'Grace Hopper',
      email: 'grace@example.test',
      roles: ['tenant_admin'],
      status: 'active',
    });
    expect(byId.get(unnamed.membershipId)).toMatchObject({
      name: null,
      email: 'nameless@example.test',
    });
    expect(byId.get(noPerson.membershipId)).toMatchObject({
      name: null,
      email: '',
      status: 'suspended',
    });
    expect(byId.has(applicant.membershipId)).toBe(false);
    expect(byId.has(removed.membershipId)).toBe(false);
    expect(Object.keys(byId.get(lister.membershipId) ?? {}).sort()).toEqual([
      'email',
      'id',
      'name',
      'roles',
      'status',
    ]);
  });

  it('shows only pending invitations that have not expired', async () => {
    const pending = await call(admin, 'POST', '/invitations', {
      email: `${testSlug()}@example.test`,
      roles: ['reviewer'],
    });
    const expired = await call(admin, 'POST', '/invitations', {
      email: `${testSlug()}@example.test`,
      roles: ['reviewer'],
    });
    const revoked = await call(admin, 'POST', '/invitations', {
      email: `${testSlug()}@example.test`,
      roles: ['reviewer'],
    });
    const [kept, old, gone] = [pending, expired, revoked].map((r) => r.json<Invitation>());
    await rows(
      tenant,
      `UPDATE app.invitation SET created_at = now() - interval '8 days',
              expires_at = now() - interval '8 days' + interval '168 hours' WHERE id = $1`,
      [old?.id],
    );
    expect((await call(admin, 'DELETE', `/invitations/${gone?.id}`)).statusCode).toBe(204);

    const { invitations } = await team(admin);
    expect(invitations.map((invitation) => invitation.id)).toContain(kept?.id);
    expect(invitations.map((invitation) => invitation.id)).not.toContain(old?.id);
    expect(invitations.map((invitation) => invitation.id)).not.toContain(gone?.id);
    expect(Object.keys(invitations[0] ?? {}).sort()).toEqual(['email', 'expiresAt', 'id', 'roles']);
  });
});

describe('invitations', { timeout: 60_000 }, () => {
  it('invites by email with roles, writes the event and emails a link', async () => {
    const email = `${testSlug()}@example.test`;
    const response = await call(admin, 'POST', '/invitations', {
      email: ` ${email.toUpperCase()} `,
      roles: ['programme_manager', 'reviewer'],
    });
    expect(response.statusCode, response.body).toBe(201);
    const invitation = response.json<Invitation>();
    expect(invitation).toMatchObject({ email, roles: ['programme_manager', 'reviewer'] });
    expect(sent.at(-1)?.to).toBe(email);
    expect(sent.at(-1)?.text).toContain(`/${tenant.slug}/invitation#token=`);
    const [event] = await events(tenant, 'platform.invitation.sent', invitation.id);
    expect(event?.actor_id).toBe(admin.membershipId);
  });

  it('refuses roles it does not offer, extra keys and a bad address', async () => {
    for (const body of [
      { email: 'a@example.test', roles: ['applicant'] },
      { email: 'a@example.test', roles: [] },
      { email: 'a@example.test', roles: ['reviewer', 'reviewer'] },
      { email: 'a@example.test', roles: ['reviewer'], tenantId: other.id },
      { email: 'not an address', roles: ['reviewer'] },
    ]) {
      expect(
        (await call(admin, 'POST', '/invitations', body)).statusCode,
        JSON.stringify(body),
      ).toBe(400);
    }
  });

  it('refuses someone in the team or already invited', async () => {
    const member = await add(tenant, 'reviewer');
    const [{ email }] = (await withClient(
      'migrator',
      async (client) =>
        (
          await client.query<{ email: string }>('SELECT email FROM auth."user" WHERE id = $1', [
            member.userId,
          ])
        ).rows,
    )) as [{ email: string }];
    expect(
      (await call(admin, 'POST', '/invitations', { email, roles: ['reviewer'] })).statusCode,
    ).toBe(409);

    const fresh = { email: `${testSlug()}@example.test`, roles: ['reviewer'] };
    expect((await call(admin, 'POST', '/invitations', fresh)).statusCode).toBe(201);
    expect((await call(admin, 'POST', '/invitations', fresh)).statusCode).toBe(409);
  });

  it('keeps nothing when the email cannot be sent', async () => {
    const email = `${testSlug()}@example.test`;
    mailWorks = false;
    try {
      const response = await call(admin, 'POST', '/invitations', { email, roles: ['reviewer'] });
      expect(response.statusCode).toBe(503);
    } finally {
      mailWorks = true;
    }
    expect(await rows(tenant, 'SELECT 1 FROM app.invitation WHERE email = $1', [email])).toEqual(
      [],
    );
  });

  it('revokes a pending invitation and writes the event', async () => {
    const made = await call(admin, 'POST', '/invitations', {
      email: `${testSlug()}@example.test`,
      roles: ['reviewer'],
    });
    const { id } = made.json<Invitation>();
    expect((await call(admin, 'DELETE', `/invitations/${id}`)).statusCode).toBe(204);
    const [event] = await events(tenant, 'platform.invitation.revoked', id);
    expect(event).toMatchObject({
      actor_id: admin.membershipId,
      changes: { 'app.invitation.status': { before: 'pending', after: 'revoked' } },
    });
    expect((await call(admin, 'DELETE', `/invitations/${id}`)).statusCode).toBe(404);
  });
});

describe('changing a member', { timeout: 60_000 }, () => {
  it('changes roles, ends the member’s sessions in this tenant only, and writes the values', async () => {
    const member = await add(tenant, 'reviewer', {
      name: ['Rae', 'Viewer'],
      email: 'rae@example.test',
    });
    const here = await liveSession(member);
    const elsewhere = await liveSession(member, other);

    let response!: LightMyRequestResponse;
    await expectRevocationAudited(member, async () => {
      response = await call(admin, 'PUT', `/members/${member.membershipId}/roles`, {
        roles: ['programme_manager', 'reviewer'],
      });
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<Member>()).toEqual({
      id: member.membershipId,
      name: 'Rae Viewer',
      email: 'rae@example.test',
      roles: ['programme_manager', 'reviewer'],
      status: 'active',
    });
    expect((await state(member))?.roles).toEqual(['programme_manager', 'reviewer']);
    expect(await here()).toBe(true);
    expect(await elsewhere()).toBe(false);
    const [event] = await events(tenant, 'platform.membership.roles_changed', member.membershipId);
    expect(event).toMatchObject({
      actor_id: admin.membershipId,
      changes: {
        'app.membership.roles': { before: ['reviewer'], after: ['programme_manager', 'reviewer'] },
      },
    });
  });

  it('does nothing, and writes nothing, when the roles are the same', async () => {
    const member = await add(tenant, 'reviewer');
    const session = await liveSession(member);
    const response = await call(admin, 'PUT', `/members/${member.membershipId}/roles`, {
      roles: ['reviewer'],
    });
    expect(response.statusCode).toBe(200);
    expect(await session()).toBe(false);
    expect(await events(tenant, 'platform.membership.roles_changed', member.membershipId)).toEqual(
      [],
    );
  });

  it('refuses roles the console does not offer', async () => {
    const member = await add(tenant, 'reviewer');
    for (const roles of [['applicant'], [], ['owner'], ['reviewer', 'reviewer']]) {
      const response = await call(admin, 'PUT', `/members/${member.membershipId}/roles`, { roles });
      expect(response.statusCode, roles.join()).toBe(400);
    }
    expect((await state(member))?.roles).toEqual(['reviewer']);
  });

  it('suspends and reinstates, and ends sessions on suspension', async () => {
    const member = await add(tenant, 'reviewer');
    const session = await liveSession(member);
    const path = `/members/${member.membershipId}`;

    let suspended!: LightMyRequestResponse;
    await expectRevocationAudited(member, async () => {
      suspended = await call(admin, 'POST', `${path}/suspend`);
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect(suspended.json<Member>().status).toBe('suspended');
    expect((await state(member))?.status).toBe('suspended');
    expect(await session()).toBe(true);
    expect(
      (await events(tenant, 'platform.membership.suspended', member.membershipId))[0],
    ).toMatchObject({
      actor_id: admin.membershipId,
      changes: { 'app.membership.status': { before: 'active', after: 'suspended' } },
    });
    expect((await call(admin, 'POST', `${path}/suspend`)).statusCode).toBe(409);

    const again = await liveSession(member);
    const reinstated = await call(admin, 'POST', `${path}/reinstate`);
    expect(reinstated.statusCode, reinstated.body).toBe(200);
    expect(reinstated.json<Member>().status).toBe('active');
    expect(await again()).toBe(false);
    expect(
      (await events(tenant, 'platform.membership.reinstated', member.membershipId))[0],
    ).toMatchObject({
      changes: { 'app.membership.status': { before: 'suspended', after: 'active' } },
    });
    expect((await call(admin, 'POST', `${path}/reinstate`)).statusCode).toBe(409);
  });

  it('removes a member, ends their sessions and drops them from the list', async () => {
    const member = await add(tenant, 'reviewer');
    const session = await liveSession(member);
    const path = `/members/${member.membershipId}`;

    let removed!: LightMyRequestResponse;
    await expectRevocationAudited(member, async () => {
      removed = await call(admin, 'DELETE', path);
    });
    expect(removed.statusCode).toBe(204);
    expect((await state(member))?.status).toBe('removed');
    expect(await session()).toBe(true);
    expect(
      (await events(tenant, 'platform.membership.removed', member.membershipId))[0],
    ).toMatchObject({
      changes: { 'app.membership.status': { before: 'active', after: 'removed' } },
    });
    expect((await team(admin)).members.map((m) => m.id)).not.toContain(member.membershipId);
    expect((await call(admin, 'DELETE', path)).statusCode).toBe(404);
    expect((await call(admin, 'POST', `${path}/reinstate`)).statusCode).toBe(404);
  });

  it('refuses a change to the administrator’s own membership', async () => {
    const self = await add(tenant, 'tenant_admin');
    const path = `/members/${self.membershipId}`;
    const attempts: [Method, string, object?][] = [
      ['PUT', `${path}/roles`, { roles: ['reviewer'] }],
      ['POST', `${path}/suspend`],
      ['DELETE', path],
    ];
    for (const [method, url, body] of attempts) {
      expect((await call(self, method, url, body)).statusCode, url).toBe(409);
    }
    expect(await state(self)).toEqual({ status: 'active', roles: ['tenant_admin'] });
  });

  it('leaves at least one active administrator when two act on each other at once', async () => {
    const lone = await createTestTenant();
    const first = await add(lone, 'tenant_admin');
    const second = await add(lone, 'tenant_admin');
    const statuses = (
      await Promise.all([
        call(first, 'POST', `/members/${second.membershipId}/suspend`),
        call(second, 'POST', `/members/${first.membershipId}/suspend`),
      ])
    ).map((response) => response.statusCode);

    expect(statuses).toContain(200);
    const active = await rows(
      lone,
      "SELECT 1 FROM app.membership WHERE status = 'active' AND roles && ARRAY['tenant_admin']",
    );
    expect(active).toHaveLength(1);
  });
});

describe('another tenant', { timeout: 60_000 }, () => {
  it('answers a member or invitation of another tenant as it does a missing one', async () => {
    const target = await add(tenant, 'reviewer');
    const session = await liveSession(target);
    const made = await call(admin, 'POST', '/invitations', {
      email: `${testSlug()}@example.test`,
      roles: ['reviewer'],
    });
    const invitation = made.json<Invitation>();
    const missing = randomUUID();

    const attempts: [Method, (id: string) => string, object?][] = [
      ['PUT', (id) => `/members/${id}/roles`, { roles: ['programme_manager'] }],
      ['POST', (id) => `/members/${id}/suspend`],
      ['POST', (id) => `/members/${id}/reinstate`],
      ['DELETE', (id) => `/members/${id}`],
    ];
    for (const [method, path, body] of attempts) {
      expectLooksMissing(
        await call(otherAdmin, method, path(target.membershipId), body),
        await call(otherAdmin, method, path(missing), body),
      );
    }
    expectLooksMissing(
      await call(otherAdmin, 'DELETE', `/invitations/${invitation.id}`),
      await call(otherAdmin, 'DELETE', `/invitations/${missing}`),
    );

    expect(await state(target)).toEqual({ status: 'active', roles: ['reviewer'] });
    expect(await session()).toBe(false);
    expect((await team(admin)).invitations.map((i) => i.id)).toContain(invitation.id);
  });

  it('lists only its own team', async () => {
    const { members, invitations } = await team(otherAdmin);
    expect(members.map((member) => member.id)).toEqual([otherAdmin.membershipId]);
    expect(invitations).toEqual([]);
  });

  it('keeps an applicant of the same tenant out of the team', async () => {
    const applicant = await add(tenant, 'applicant');
    expect(
      (await call(admin, 'POST', `/members/${applicant.membershipId}/suspend`)).statusCode,
    ).toBe(404);
    expect((await state(applicant))?.status).toBe('active');
  });
});
