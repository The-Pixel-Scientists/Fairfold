// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The policy against the real test database, as app_api: memberships and
// module switches read under row-level security, the permission, and a
// scope rule, for two tenants. The database project supplies the settings
// (scripts/dev-env.ts, profile database-tests).

import { randomUUID } from 'node:crypto';

import { defineRoute } from '@pixel-scientists/domain/api';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createTestTenant,
  createTestUser,
  insertRow,
  asMigratorIn,
  type TestTenant,
} from '../../../packages/db/test/tenants.ts';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase, type ApiDatabase } from '../src/database.ts';
import { createLogger } from '../src/logger.ts';
import { route } from '../src/routes/register.ts';
import { expectLooksMissing, testAuth, testSession, type TestSessionOptions } from './support.ts';

const count = z.object({ members: z.number().int() });
const done = z.object({ ok: z.boolean() });
const caller = z.object({ membershipId: z.string() });

const members = defineRoute({
  method: 'GET',
  path: '/console/members',
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
  summary: 'Count the members the caller can see',
  responses: { 200: count },
});

const programmes = defineRoute({
  method: 'GET',
  path: '/console/programmes',
  audience: 'console',
  module: 'grants',
  permission: 'grants.programmes.manage',
  scope: 'tenant',
  summary: 'List programmes',
  responses: { 200: done },
});

const review = defineRoute({
  method: 'GET',
  path: '/console/reviews/:reviewId',
  audience: 'console',
  module: 'grants',
  permission: 'grants.reviews.score',
  scope: 'assigned_review',
  summary: 'Read a review',
  params: z.strictObject({ reviewId: z.uuid() }),
  responses: { 200: done },
});

const release = defineRoute({
  method: 'POST',
  path: '/console/releases',
  audience: 'console',
  module: 'grants',
  permission: 'grants.decisions.release',
  scope: 'tenant',
  stepUp: true,
  summary: 'Release decisions',
  body: z.strictObject({}),
  responses: { 200: done },
});

const profile = defineRoute({
  method: 'GET',
  path: '/portal/profile',
  audience: 'portal',
  module: 'party',
  permission: 'party.profile.manage',
  scope: 'own_person',
  summary: 'Read the caller',
  responses: { 200: caller },
});

interface Person {
  userId: string;
  membershipId: string;
}

let api: FastifyInstance;
let database: ApiDatabase;
const auth = testAuth();

let tenantA: TestTenant;
let tenantB: TestTenant;
const people: Record<string, Person> = {};
/** Which review each reviewer is assigned, for the assigned_review scope rule. */
const assigned = new Map<string, string>();
const reviewOfAnotherReviewer = randomUUID();
const ownReview = randomUUID();

async function addPerson(
  tenant: TestTenant,
  name: string,
  roles: string[],
  status = 'active',
): Promise<void> {
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(tenant.id, (client) =>
    insertRow(client, 'app.membership', { tenant_id: tenant.id, user_id: userId, roles, status }),
  );
  people[name] = { userId, membershipId };
}

beforeAll(async () => {
  const { database: settings } = loadConfig({
    ...process.env,
    TPS_API_PORT: '41000',
    TPS_DB_NAME: process.env['TPS_TEST_DB_NAME'],
  });
  const logger = createLogger({ level: 'silent' });
  database = openDatabase(settings, logger);

  [tenantA, tenantB] = await Promise.all([createTestTenant(), createTestTenant()]);
  await addPerson(tenantA, 'admin', ['tenant_admin']);
  await addPerson(tenantA, 'manager', ['programme_manager']);
  await addPerson(tenantA, 'reviewer', ['reviewer']);
  await addPerson(tenantA, 'otherReviewer', ['reviewer']);
  await addPerson(tenantA, 'applicant', ['applicant']);
  await addPerson(tenantA, 'suspended', ['tenant_admin'], 'suspended');
  await addPerson(tenantA, 'removed', ['tenant_admin'], 'removed');
  await addPerson(tenantB, 'adminB', ['tenant_admin']);
  await addPerson(tenantB, 'managerB', ['programme_manager']);
  assigned.set(people['reviewer']?.userId ?? '', ownReview);
  assigned.set(people['otherReviewer']?.userId ?? '', reviewOfAnotherReviewer);

  api = await buildApp({
    logger,
    checkDatabase: () => database.check(),
    inTenant: database.inTenant,
    auth: auth.module,
    resolvers: {
      assigned_review: ({ userId, input }) =>
        Promise.resolve(assigned.get(userId) === (input.params as { reviewId: string }).reviewId),
      own_person: () => Promise.resolve(true),
    },
    routes: [
      route(members, async ({ tx }) => {
        const rows = await tx
          .$extendTables<{ 'app.membership': { id: string } }>()
          .selectFrom('app.membership')
          .select('id')
          .execute();
        return { members: rows.length };
      }),
      route(programmes, () => Promise.resolve({ ok: true })),
      route(review, () => Promise.resolve({ ok: true })),
      route(release, () => Promise.resolve({ ok: true })),
      route(profile, ({ context }) => Promise.resolve({ membershipId: context.membership.id })),
    ],
  });
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

/** A request as a person, in the tenant their membership is in unless told otherwise. */
function asPerson(name: string, tenant: TestTenant, options: TestSessionOptions = {}) {
  const person = people[name];
  if (person === undefined) throw new Error(`No person ${name}.`);
  const session = testSession({ userId: person.userId, tenant: tenant.id, ...options });
  return auth.as({ app: session.app, session });
}

const get = (url: string, headers: Record<string, string>) =>
  api.inject({ url: `/api${url}`, headers });

describe('the policy against the database', () => {
  it('lets an active member with the permission in, and shows only their tenant', async () => {
    const inA = await get('/console/members', asPerson('admin', tenantA));
    const inB = await get('/console/members', asPerson('adminB', tenantB));

    expect(inA.statusCode).toBe(200);
    expect(inA.json()).toEqual({ members: 7 });
    expect(inB.json()).toEqual({ members: 2 });
  });

  it('takes the actor from the session: the handler sees the session user membership', async () => {
    const response = await get(
      '/portal/profile',
      asPerson('applicant', tenantA, { app: 'portal' }),
    );

    expect(response.json()).toEqual({ membershipId: people['applicant']?.membershipId });
  });

  it('refuses a suspended or removed member', async () => {
    for (const name of ['suspended', 'removed']) {
      const response = await get('/console/members', asPerson(name, tenantA));
      expect(response.statusCode, name).toBe(403);
      expect(response.json<{ detail: string }>().detail).toBe(
        'You do not have permission to do this.',
      );
    }
  });

  it('refuses a member who lacks the permission, by what their roles give and not their names', async () => {
    expect((await get('/console/members', asPerson('reviewer', tenantA))).statusCode).toBe(403);
    expect((await get('/console/members', asPerson('manager', tenantA))).statusCode).toBe(403);
    expect((await get('/console/programmes', asPerson('admin', tenantA))).statusCode).toBe(403);
    expect((await get('/console/programmes', asPerson('manager', tenantA))).statusCode).toBe(200);
  });

  it('refuses a session of the other app', async () => {
    const response = await get(
      '/console/members',
      asPerson('applicant', tenantA, { app: 'portal' }),
    );

    expect(response.statusCode).toBe(403);
  });

  it('shows nothing across tenants: a member of one is no member of another', async () => {
    for (const [name, tenant] of [
      ['admin', tenantB],
      ['adminB', tenantA],
      ['manager', tenantB],
    ] as const) {
      const response = await get('/console/members', asPerson(name, tenant));
      expect(response.statusCode, `${name} in the other tenant`).toBe(403);
    }
  });

  it('answers an object outside the caller scope as it answers a missing one', async () => {
    const own = await get(`/console/reviews/${ownReview}`, asPerson('reviewer', tenantA));
    const outside = await get(
      `/console/reviews/${reviewOfAnotherReviewer}`,
      asPerson('reviewer', tenantA),
    );
    const missing = await get(`/console/reviews/${randomUUID()}`, asPerson('reviewer', tenantA));

    expect(own.statusCode).toBe(200);
    expectLooksMissing(outside, missing);
  });

  it('answers 404 for a module switched off for the tenant, and for that tenant only', async () => {
    const manager = (tenant: TestTenant, name: string) =>
      get('/console/programmes', asPerson(name, tenant));
    const switchTo = (enabled: boolean) =>
      asMigratorIn(tenantA.id, (client) =>
        client
          .query(
            `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by)
             VALUES ($1, 'grants', $2, $3)
             ON CONFLICT (tenant_id, module) DO UPDATE SET enabled = EXCLUDED.enabled`,
            [tenantA.id, enabled, people['admin']?.membershipId],
          )
          .then(() => undefined),
      );

    await switchTo(false);
    try {
      const off = await manager(tenantA, 'manager');
      expect(off.statusCode).toBe(404);
      expect(off.json<{ detail: string }>().detail).toBe('We could not find what you asked for.');
      expect((await manager(tenantB, 'managerB')).statusCode).toBe(200);
      // The platform's own routes stay on.
      expect((await get('/console/members', asPerson('admin', tenantA))).statusCode).toBe(200);
    } finally {
      await switchTo(true);
    }
    expect((await manager(tenantA, 'manager')).statusCode).toBe(200);
  });

  it('needs re-authentication in the last 5 minutes to release decisions', async () => {
    const post = (headers: Record<string, string>) =>
      api.inject({ method: 'POST', url: '/api/console/releases', payload: {}, headers });

    expect((await post(asPerson('manager', tenantA))).statusCode).toBe(403);
    expect(
      (await post(asPerson('manager', tenantA, { recentAuthAt: new Date() }))).statusCode,
    ).toBe(200);
    expect((await post(asPerson('admin', tenantA, { recentAuthAt: new Date() }))).statusCode).toBe(
      403,
    );
  });
});
