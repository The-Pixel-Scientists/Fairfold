// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The teams routes through the whole API against the test database (ADR
// 0037): the policy, step-up, row-level security and the audit events. The
// session itself is a stand-in.

import { randomUUID } from 'node:crypto';

import { permissionsFor, roles, type Role } from '@pixel-scientists/domain/platform';
import type { TeamDetail, TeamSummary } from '@pixel-scientists/domain/platform/team';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectionSettings } from '../../../../../packages/db/test/connect.ts';
import { addPerson } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import { expectLooksMissing, testAuth, testSession } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { Secret } from '../../config.ts';
import { openDatabase, type ApiDatabase } from '../../database.ts';
import { createLogger } from '../../logger.ts';
import { composeModules } from '../../modules.ts';
import { teamsRoutes } from './index.ts';

const STEP_UP = 'Confirm it is you again, then try again.';

interface Person {
  readonly userId: string;
  readonly membershipId: string;
  readonly tenant: TestTenant;
  readonly app: 'console' | 'portal';
}

let api: FastifyInstance;
let database: ApiDatabase;
const stand = testAuth();

let tenant: TestTenant;
let other: TestTenant;
let admin: Person;
let otherAdmin: Person;

async function add(
  target: TestTenant,
  role: string,
  options: { name?: [string, string]; status?: string } = {},
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
    if (options.name !== undefined) {
      await addPerson(client, target, {
        user_id: userId,
        given_name: options.name[0],
        family_name: options.name[1],
      });
    }
    return id;
  });
  return { userId, membershipId, tenant: target, app };
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A request as `who`, signed in a minute ago unless `fresh` is false. */
function call(
  who: Person | undefined,
  method: Method,
  path: string,
  payload?: object,
  options: { fresh?: boolean; key?: string } = {},
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
            recentAuthAt: options.fresh === false ? null : new Date(Date.now() - 60_000),
          }),
        });
  return api.inject({
    method,
    url: `/api/console/teams${path}`,
    headers: { ...headers, 'idempotency-key': options.key ?? randomUUID() },
    ...(payload === undefined ? {} : { payload }),
  });
}

const rows = <T>(target: TestTenant, query: string, values: unknown[] = []): Promise<T[]> =>
  asMigratorIn(target.id, async (client) => (await client.query(query, values)).rows as T[]);

const uniqueName = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

async function makeTeam(who: Person, name = uniqueName('Team')): Promise<TeamSummary> {
  const response = await call(who, 'POST', '', { name });
  expect(response.statusCode).toBe(201);
  return response.json<TeamSummary>();
}

const members = async (who: Person, team: TeamSummary) =>
  (await call(who, 'GET', `/${team.id}`)).json<TeamDetail>().members;

interface AuditRow {
  actor_id: string;
  entity_id: string;
  changes: Record<string, { before?: unknown; after?: unknown }>;
}

const events = (target: TestTenant, action: string, entityId?: string) =>
  rows<AuditRow>(
    target,
    `SELECT actor_id, entity_id, changes FROM app.audit_event
      WHERE action = $1 AND ($2::uuid IS NULL OR entity_id = $2)`,
    [action, entityId ?? null],
  );

beforeAll(async () => {
  const appApi = connectionSettings('app_api');
  const logger = createLogger({ level: 'silent' });
  database = openDatabase(
    {
      host: appApi.host,
      port: appApi.port,
      database: appApi.database,
      password: new Secret(appApi.password),
    },
    logger,
  );
  const composed = composeModules({ publicTenants: database.publicTenants });
  api = await buildApp({
    logger,
    checkDatabase: () => Promise.resolve(),
    inTenant: database.inTenant,
    auth: stand.module,
    ...composed,
    routes: [...composed.routes, ...teamsRoutes()],
  });
  [tenant, other] = await Promise.all([createTestTenant(), createTestTenant()]);
  admin = await add(tenant, 'tenant_admin', { name: ['Ada', 'Lovelace'] });
  otherAdmin = await add(other, 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

describe('who may use the teams routes', { timeout: 60_000 }, () => {
  const id = randomUUID();
  const requests: [Method, string, object?][] = [
    ['GET', ''],
    ['GET', `/${id}`],
    ['POST', '', { name: 'Anyone' }],
    ['PATCH', `/${id}`, { name: 'Anyone' }],
    ['POST', `/${id}/archive`],
    ['PUT', `/${id}/members/${id}`],
    ['DELETE', `/${id}/members/${id}`],
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
        expect((await call(outsider, method, path, body)).statusCode, `${method} ${path}`).toBe(
          403,
        );
      }
      const allowed = await call(admin, method, path, body);
      expect([401, 403], `${method} ${path}`).not.toContain(allowed.statusCode);
    }
  });

  it('asks for a recent sign-in on every change, and not to read', async () => {
    const team = await makeTeam(admin);
    expect((await call(admin, 'GET', '', undefined, { fresh: false })).statusCode).toBe(200);
    expect((await call(admin, 'GET', `/${team.id}`, undefined, { fresh: false })).statusCode).toBe(
      200,
    );
    for (const [method, path, body] of requests.slice(2)) {
      const response = await call(admin, method, path, body, { fresh: false });
      expect(response.statusCode, path).toBe(403);
      expect(response.json<{ detail: string }>().detail).toBe(STEP_UP);
    }
  });

  it('gives reach only: a team never gives a member a permission', async () => {
    const reviewer = await add(tenant, 'reviewer');
    const team = await makeTeam(admin);
    expect(
      (await call(admin, 'PUT', `/${team.id}/members/${reviewer.membershipId}`)).statusCode,
    ).toBe(204);
    expect((await call(reviewer, 'GET', '')).statusCode).toBe(403);
    expect((await call(reviewer, 'POST', '', { name: uniqueName('Mine') })).statusCode).toBe(403);
    expect(permissionsFor(['reviewer'], 'console')).not.toContain('platform.teams.manage');
  });
});

describe('creating, renaming and archiving a team', { timeout: 60_000 }, () => {
  it('creates a team, audits it by id and answers a replay with the same team', async () => {
    const name = uniqueName('Safeguarding');
    const key = randomUUID();
    const first = await call(admin, 'POST', '', { name }, { key });
    expect(first.statusCode).toBe(201);
    const team = first.json<TeamSummary>();
    expect(team).toEqual({ id: team.id, name, memberCount: 0, archivedAt: null });

    const replay = await call(admin, 'POST', '', { name }, { key });
    expect(replay.statusCode).toBe(201);
    expect(replay.json<TeamSummary>().id).toBe(team.id);

    const created = await events(tenant, 'platform.team.created');
    const mine = created.filter((row) => row.entity_id === team.id);
    expect(mine).toEqual([{ actor_id: admin.membershipId, entity_id: team.id, changes: {} }]);
    expect(JSON.stringify(mine)).not.toContain(name);
  });

  it('refuses a name that is taken, in any case, without saying whose it is', async () => {
    const name = uniqueName('Duty team');
    await makeTeam(admin, name);
    for (const again of [name, name.toUpperCase()]) {
      const response = await call(admin, 'POST', '', { name: again });
      expect(response.statusCode).toBe(409);
      expect(response.body).not.toContain(name);
      expect(response.json<{ detail: string }>().detail).toMatch(/already exists/);
    }
    // Another tenant may use the same name.
    expect((await call(otherAdmin, 'POST', '', { name })).statusCode).toBe(201);
  });

  it('refuses a name that is empty, long, hidden or with an extra field', async () => {
    for (const body of [
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { name: 'Team\u202e' },
      { name: '!!!' },
      { name: 'Fine', tenantId: other.id },
      {},
    ]) {
      expect((await call(admin, 'POST', '', body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('renames and archives, writes each event once, and freezes an archived team', async () => {
    const team = await makeTeam(admin);
    const renamed = await call(admin, 'PATCH', `/${team.id}`, { name: uniqueName('Renamed') });
    expect(renamed.statusCode).toBe(200);
    expect((await events(tenant, 'platform.team.renamed', team.id)).length).toBe(1);
    // The same name again changes nothing and writes nothing.
    await call(admin, 'PATCH', `/${team.id}`, { name: renamed.json<TeamSummary>().name });
    expect((await events(tenant, 'platform.team.renamed', team.id)).length).toBe(1);

    const taken = await makeTeam(admin);
    const clash = await call(admin, 'PATCH', `/${team.id}`, { name: taken.name });
    expect(clash.statusCode).toBe(409);

    const archived = await call(admin, 'POST', `/${team.id}/archive`);
    expect(archived.statusCode).toBe(200);
    expect(archived.json<TeamSummary>().archivedAt).not.toBeNull();
    await call(admin, 'POST', `/${team.id}/archive`);
    expect((await events(tenant, 'platform.team.archived', team.id)).length).toBe(1);

    expect(
      (await call(admin, 'PATCH', `/${team.id}`, { name: uniqueName('Late') })).statusCode,
    ).toBe(409);
    const joiner = await add(tenant, 'reviewer');
    const late = await call(admin, 'PUT', `/${team.id}/members/${joiner.membershipId}`);
    expect(late.statusCode).toBe(409);
    // An archived team's name is free again.
    expect((await call(admin, 'POST', '', { name: team.name })).statusCode).toBe(201);
  });

  it('lists every team of the tenant, archived ones too', async () => {
    const team = await makeTeam(admin);
    await call(admin, 'POST', `/${team.id}/archive`);
    const listed = (await call(admin, 'GET', '')).json<{ teams: TeamSummary[] }>().teams;
    expect(listed.find((item) => item.id === team.id)?.archivedAt).not.toBeNull();
    expect(listed.every((item) => item.name !== '')).toBe(true);
  });
});

describe('team members', { timeout: 60_000 }, () => {
  it('adds and removes a member with an event each, and shows names, never emails', async () => {
    const team = await makeTeam(admin);
    const lead = await add(tenant, 'programme_manager', { name: ['Grace', 'Hopper'] });
    const added = await call(admin, 'PUT', `/${team.id}/members/${lead.membershipId}`);
    expect(added.statusCode).toBe(204);
    // Adding again changes nothing.
    expect((await call(admin, 'PUT', `/${team.id}/members/${lead.membershipId}`)).statusCode).toBe(
      204,
    );

    const addedEvents = await rows<AuditRow>(
      tenant,
      `SELECT actor_id, entity_id, changes FROM app.audit_event
        WHERE action = 'platform.team_member.added' AND changes->>'app.team_member.team_id' IS NOT NULL
          AND changes->'app.team_member.team_id'->>'after' = $1`,
      [team.id],
    );
    expect(addedEvents.length).toBe(1);
    expect(addedEvents[0]).toMatchObject({
      actor_id: admin.membershipId,
      changes: {
        'app.team_member.team_id': { after: team.id },
        'app.team_member.membership_id': { after: lead.membershipId },
      },
    });

    const read = (await call(admin, 'GET', `/${team.id}`)).json<TeamDetail>();
    expect(read.memberCount).toBe(1);
    expect(read.members).toEqual([
      { membershipId: lead.membershipId, name: 'Grace Hopper', status: 'active' },
    ]);

    expect(
      (await call(admin, 'DELETE', `/${team.id}/members/${lead.membershipId}`)).statusCode,
    ).toBe(204);
    expect(await members(admin, team)).toEqual([]);
    expect(
      (await call(admin, 'DELETE', `/${team.id}/members/${lead.membershipId}`)).statusCode,
    ).toBe(404);
    expect(
      await events(tenant, 'platform.team_member.removed', addedEvents[0]?.entity_id),
    ).toHaveLength(1);

    // Joining again is a new spell.
    expect((await call(admin, 'PUT', `/${team.id}/members/${lead.membershipId}`)).statusCode).toBe(
      204,
    );
    expect(await members(admin, team)).toHaveLength(1);
  });

  it('shows a suspended member as suspended and refuses applicants and removed members', async () => {
    const team = await makeTeam(admin);
    const suspended = await add(tenant, 'reviewer', { status: 'suspended' });
    const applicant = await add(tenant, 'applicant');
    const gone = await add(tenant, 'reviewer', { status: 'removed' });
    expect(
      (await call(admin, 'PUT', `/${team.id}/members/${suspended.membershipId}`)).statusCode,
    ).toBe(204);
    for (const person of [applicant, gone]) {
      expect(
        (await call(admin, 'PUT', `/${team.id}/members/${person.membershipId}`)).statusCode,
      ).toBe(404);
    }
    expect((await members(admin, team)).map((m) => m.status)).toEqual(['suspended']);
  });

  it('reads an unknown team, and a bad id, as not found', async () => {
    expect((await call(admin, 'GET', `/${randomUUID()}`)).statusCode).toBe(404);
    expect((await call(admin, 'GET', '/not-an-id')).statusCode).toBe(400);
    expect(
      (await call(admin, 'PUT', `/${randomUUID()}/members/${admin.membershipId}`)).statusCode,
    ).toBe(404);
  });
});

describe('teams across tenants', { timeout: 60_000 }, () => {
  it('shows another tenant nothing, and answers its ids as it answers a missing one', async () => {
    const team = await makeTeam(admin);
    const member = await add(tenant, 'reviewer');
    await call(admin, 'PUT', `/${team.id}/members/${member.membershipId}`);

    const listed = (await call(otherAdmin, 'GET', '')).json<{ teams: TeamSummary[] }>().teams;
    expect(listed.map((item) => item.id)).not.toContain(team.id);

    const missing = randomUUID();
    const attempts: [Method, (id: string) => string, object?][] = [
      ['GET', (id) => `/${id}`],
      ['PATCH', (id) => `/${id}`, { name: uniqueName('Taken over') }],
      ['POST', (id) => `/${id}/archive`],
      ['PUT', (id) => `/${id}/members/${otherAdmin.membershipId}`],
      ['DELETE', (id) => `/${id}/members/${member.membershipId}`],
    ];
    for (const [method, path, body] of attempts) {
      const outside = await call(otherAdmin, method, path(team.id), body);
      const absent = await call(otherAdmin, method, path(missing), body);
      expectLooksMissing(outside, absent);
    }

    // Nothing of tenant A's changed.
    const after = (await call(admin, 'GET', `/${team.id}`)).json<TeamDetail>();
    expect(after).toMatchObject({ name: team.name, archivedAt: null, memberCount: 1 });
  });

  it('refuses to put a member of one tenant in another tenant', async () => {
    const mine = await makeTeam(otherAdmin);
    const outsider = await add(tenant, 'reviewer');
    const response = await call(otherAdmin, 'PUT', `/${mine.id}/members/${outsider.membershipId}`);
    const unknown = await call(otherAdmin, 'PUT', `/${mine.id}/members/${randomUUID()}`);
    expectLooksMissing(response, unknown);
    expect(await members(otherAdmin, mine)).toEqual([]);
    expect(
      await rows<object>(other, 'SELECT 1 FROM app.team_member WHERE team_id = $1', [mine.id]),
    ).toEqual([]);
  });
});
