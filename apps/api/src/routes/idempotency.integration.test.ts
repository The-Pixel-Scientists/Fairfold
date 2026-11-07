// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Idempotency keys against the test database (ADR 0028): reservation,
// replay, conflict, release on failure, scope by member and tenant, and two
// requests in flight. The route is a stand-in that creates nothing but an id,
// so the handler's call count stands for the resources created.

import { randomUUID } from 'node:crypto';

import { defineRoute } from '@pixel-scientists/domain/api';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { connectionSettings } from '../../../../packages/db/test/connect.ts';
import {
  asMigratorIn,
  createTestTenant,
  createTestUser,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { testAuth, testSession } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import { Secret } from '../config.ts';
import { openDatabase, type ApiDatabase } from '../database.ts';
import { createLogger } from '../logger.ts';
import { ApiError } from '../problems.ts';
import { route } from './register.ts';

const widget = z.strictObject({ id: z.uuid() });
const create = defineRoute({
  method: 'POST',
  idempotent: true,
  path: '/console/widgets',
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
  summary: 'Create a widget',
  body: z.strictObject({ name: z.string(), size: z.int().optional() }),
  responses: { 201: widget },
});

/** What the stand-in handler does next; each test sets it. */
let created = 0;
let gate: Promise<void> = Promise.resolve();
let fail = false;
let readable = true;

interface Person {
  readonly userId: string;
  readonly membershipId: string;
  readonly tenant: TestTenant;
}

let api: FastifyInstance;
let database: ApiDatabase;
const stand = testAuth();
let tenant: TestTenant;
let other: TestTenant;
let admin: Person;
let colleague: Person;
let outsider: Person;
let manager: Person;

async function add(target: TestTenant, role: string): Promise<Person> {
  const userId = await createTestUser();
  const membershipId = await asMigratorIn(target.id, (client) =>
    insertRow(client, 'app.membership', {
      tenant_id: target.id,
      user_id: userId,
      roles: [role],
      status: 'active',
    }),
  );
  return { userId, membershipId, tenant: target };
}

function post(
  who: Person,
  key: string | undefined,
  payload: object = { name: 'a' },
): Promise<LightMyRequestResponse> {
  return api.inject({
    method: 'POST',
    url: '/api/console/widgets',
    headers: {
      ...stand.as({
        app: 'console',
        session: testSession({ app: 'console', userId: who.userId, tenant: who.tenant.id }),
      }),
      ...(key === undefined ? {} : { 'idempotency-key': key }),
    },
    payload,
  });
}

const keyRows = (target: TestTenant) =>
  asMigratorIn(
    target.id,
    async (client) =>
      (
        await client.query<{
          membership_id: string;
          state: string;
          status: number | null;
          created_id: string | null;
        }>(
          'SELECT membership_id, state, status, created_id FROM app.idempotency_key WHERE tenant_id = $1',
          [target.id],
        )
      ).rows,
  );

const reset = (): void => {
  created = 0;
  gate = Promise.resolve();
  fail = false;
  readable = true;
};
const later = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  api = await buildApp({
    logger,
    checkDatabase: () => Promise.resolve(),
    inTenant: database.inTenant,
    auth: stand.module,
    routes: [
      route(
        create,
        async () => {
          const failing = fail;
          created += 1;
          await gate;
          if (failing) throw new ApiError(400, 'The stand-in failed.');
          return { id: randomUUID() };
        },
        {
          replay: ({ id }) =>
            readable && id !== null
              ? Promise.resolve({ id })
              : Promise.reject(new ApiError(404, undefined, { reason: 'not_found' })),
        },
      ),
    ],
  });
  [tenant, other] = await Promise.all([createTestTenant(), createTestTenant()]);
  admin = await add(tenant, 'tenant_admin');
  colleague = await add(tenant, 'tenant_admin');
  manager = await add(tenant, 'programme_manager');
  outsider = await add(other, 'tenant_admin');
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

describe('an idempotent create route', { timeout: 30_000 }, () => {
  it('creates once and replays the same key with the first id, writing nothing more', async () => {
    reset();
    const key = randomUUID();
    const first = await post(admin, key);
    const before = await keyRows(tenant);
    const again = await post(admin, key.toUpperCase());

    expect([first.statusCode, again.statusCode]).toEqual([201, 201]);
    expect(again.json()).toEqual(first.json());
    expect(created).toBe(1);
    expect(await keyRows(tenant)).toEqual(before);
    expect(before.filter((row) => row.membership_id === admin.membershipId)).toEqual([
      {
        membership_id: admin.membershipId,
        state: 'completed',
        status: 201,
        created_id: first.json<{ id: string }>().id,
      },
    ]);
  });

  it('counts a body with its members in another order as the same request', async () => {
    reset();
    const key = randomUUID();
    await post(admin, key, { name: 'a', size: 2 });
    const again = await post(admin, key, { size: 2, name: 'a' });
    expect(again.statusCode).toBe(201);
    expect(created).toBe(1);
  });

  it('refuses the key with another request, without echoing the key, hash or id', async () => {
    reset();
    const key = randomUUID();
    const first = await post(admin, key, { name: 'private-value' });
    const again = await post(admin, key, { name: 'another-value' });

    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ type: '/problems/idempotency-key-reused', status: 409 });
    for (const secret of [key, first.json<{ id: string }>().id, 'private-value', 'another-value']) {
      expect(again.body).not.toContain(secret);
    }
    expect(created).toBe(1);
  });

  it('answers 404 to a replay the caller can no longer read, never the stored body', async () => {
    reset();
    const key = randomUUID();
    const first = await post(admin, key);
    readable = false;
    const again = await post(admin, key);

    expect(again.statusCode).toBe(404);
    expect(again.body).not.toContain(first.json<{ id: string }>().id);
  });

  it('takes the same key from another member or another tenant as a new request', async () => {
    reset();
    const key = randomUUID();
    const results = [admin, colleague, outsider].map((who) => post(who, key));
    const ids = (await Promise.all(results)).map((response) => {
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string }>().id;
    });

    expect(new Set(ids).size).toBe(3);
    expect(created).toBe(3);
    expect((await keyRows(other)).map((row) => row.membership_id)).toEqual([outsider.membershipId]);
  });

  it('refuses a caller without the permission before it reaches the key store', async () => {
    reset();
    const response = await post(manager, randomUUID());
    expect(response.statusCode).toBe(403);
    expect(created).toBe(0);
    expect((await keyRows(tenant)).filter((r) => r.membership_id === manager.membershipId)).toEqual(
      [],
    );
  });

  it.each([undefined, 'not-a-uuid', '00000000-0000-0000-0000-000000000000'])(
    'refuses a missing or invalid key (%s) as a field problem',
    async (key) => {
      reset();
      const response = await post(admin, key);
      expect(response.statusCode).toBe(400);
      expect(response.json<{ errors: { field: string }[] }>().errors).toEqual([
        { field: 'header.idempotency-key', message: expect.any(String) as string },
      ]);
      if (key !== undefined) expect(response.body).not.toContain(key);
      expect(created).toBe(0);
    },
  );

  it('frees the key when the handler fails, so a retry creates', async () => {
    reset();
    const key = randomUUID();
    const before = (await keyRows(tenant)).length;
    fail = true;
    expect((await post(admin, key)).statusCode).toBe(400);
    expect(await keyRows(tenant)).toHaveLength(before);

    fail = false;
    expect((await post(admin, key)).statusCode).toBe(201);
    expect(created).toBe(2);
  });
});

describe('two identical requests in flight', { timeout: 30_000 }, () => {
  it('create one resource: the second waits and replays the first', async () => {
    reset();
    gate = later(500);
    const key = randomUUID();
    const [first, second] = await Promise.all([post(admin, key), post(admin, key)]);

    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect(second.json()).toEqual(first.json());
    expect(created).toBe(1);
  });

  it('let the second create when the first fails', async () => {
    reset();
    gate = later(500);
    fail = true;
    const key = randomUUID();
    const first = post(admin, key);
    await later(100);
    fail = false;
    const second = post(admin, key);

    expect((await first).statusCode).toBe(400);
    expect((await second).statusCode).toBe(201);
    expect(created).toBe(2);
  });

  it('answer the in-progress problem, with Retry-After, when the first outlasts the wait', async () => {
    reset();
    gate = later(7_000);
    const key = randomUUID();
    const first = post(admin, key);
    await later(200);
    const second = await post(admin, key);

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ type: '/problems/idempotency-key-in-progress' });
    expect(second.headers['retry-after']).toBe('5');
    expect(second.body).not.toContain(key);
    expect((await first).statusCode).toBe(201);
    expect(created).toBe(1);
  });
});
