// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Idempotent routes without a database: the request hash, what start-up
// refuses, the key check before the transaction, the OpenAPI document, and a
// walk over every route the API registers.

import { defineRoute, type RouteContract } from '@pixel-scientists/domain/api';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { testAuth, testSession } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import type { InTenant } from '../database.ts';
import { createLogger } from '../logger.ts';
import { composeModules } from '../modules.ts';
import { requestHash } from './idempotency.ts';
import { route } from './register.ts';

vi.setConfig({ testTimeout: 15_000 });

const body = z.strictObject({ name: z.string() });
const member = {
  method: 'POST',
  path: '/console/widgets',
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
  summary: 'Create a widget',
  body,
  responses: { 201: z.strictObject({ id: z.uuid() }) },
} as const;
const idempotent = defineRoute({ ...member, idempotent: true });
const plain = defineRoute({ ...member, responses: { 200: z.strictObject({ id: z.uuid() }) } });

const created = () => Promise.resolve({ id: crypto.randomUUID() });
const quiet = { logger: createLogger({ level: 'silent' }), checkDatabase: () => Promise.resolve() };
const hash = (input: { params?: unknown; query?: unknown; body?: unknown }, id = 'POST /x') =>
  requestHash(id, { params: input.params, query: input.query, body: input.body }).toString('hex');

describe('the request hash', () => {
  it('ignores member order and takes every level, the route and the path', () => {
    const a = hash({ body: { a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } } });
    expect(hash({ body: { b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 } })).toBe(a);
    expect(hash({ body: { a: 1, b: { c: 2, d: [1, { e: 3, f: 5 }] } } })).not.toBe(a);
    expect(hash({ body: { a: 1 } }, 'POST /y')).not.toBe(hash({ body: { a: 1 } }));
    expect(hash({ params: { id: '1' } })).not.toBe(hash({ params: { id: '2' } }));
  });

  it('digests bytes, and reads a missing part as null', () => {
    const bytes = (value: string) => ({ name: 'f', bytes: Buffer.from(value) });
    expect(hash({ body: bytes('one') })).toBe(hash({ body: bytes('one') }));
    expect(hash({ body: bytes('one') })).not.toBe(hash({ body: bytes('two') }));
    expect(hash({})).toBe(hash({ params: null, query: undefined, body: null }));
  });
});

describe('start-up', () => {
  it('stops for an idempotent route without a replay reader', async () => {
    await expect(
      buildApp({ ...quiet, routes: [route(idempotent, created as never)] }),
    ).rejects.toThrow(/replay reader/);
  });

  it('stops for a replay reader on a route that is not idempotent', async () => {
    const withReader = route(plain, created as never, { replay: created });
    await expect(buildApp({ ...quiet, routes: [withReader] })).rejects.toThrow(/replay reader/);
  });

  it('stops for an idempotent public route', async () => {
    const forged = {
      method: 'POST',
      path: '/public/things',
      audience: 'public',
      module: 'platform',
      permission: null,
      scope: null,
      summary: 'Create',
      idempotent: true,
      responses: { 200: z.strictObject({ id: z.uuid() }) },
    } as unknown as RouteContract;
    await expect(buildApp({ ...quiet, routes: [route(forged, created as never)] })).rejects.toThrow(
      /Only a console or portal route can be idempotent/,
    );
  });
});

describe('an idempotent route', () => {
  const stand = testAuth();
  const as = () =>
    stand.as({
      app: 'console',
      session: testSession({ app: 'console', tenant: crypto.randomUUID() }),
    });

  async function start(inTenant: InTenant) {
    return buildApp({
      ...quiet,
      inTenant,
      auth: stand.module,
      routes: [route(idempotent, created, { replay: created })],
    });
  }

  it('refuses a missing key before opening a transaction', async () => {
    const inTenant = vi.fn();
    const app = await start(inTenant);
    const response = await app.inject({
      method: 'POST',
      url: '/api/console/widgets',
      headers: as(),
      payload: { name: 'a' },
    });
    expect(response.statusCode).toBe(400);
    expect(inTenant).not.toHaveBeenCalled();
    await app.close();
  });

  it('documents the key header and the two problem statuses', async () => {
    const app = await start(vi.fn());
    const document = (await app.inject({ url: '/openapi.json' })).json<{
      paths: Record<
        string,
        {
          post: {
            parameters: { name: string; in: string; required: boolean }[];
            responses: object;
          };
        }
      >;
    }>();
    const post = document.paths['/api/console/widgets']?.post;
    expect(post?.parameters).toContainEqual(
      expect.objectContaining({ name: 'idempotency-key', in: 'header', required: true }),
    );
    expect(Object.keys(post?.responses ?? {})).toContain('409');
    await app.close();
  });
});

describe('every registered route', () => {
  const { routes } = composeModules({ publicTenants: {} as never });

  it('that creates with a POST is idempotent and has a replay reader', () => {
    const creates = routes.filter(
      ({ contract }) => contract.method === 'POST' && Object.hasOwn(contract.responses, 201),
    );
    expect(creates.length).toBeGreaterThan(0);
    for (const { contract, replay } of creates) {
      expect(contract, contract.path).toMatchObject({ idempotent: true });
      expect(replay, contract.path).toBeTypeOf('function');
    }
  });

  it('has a replay reader exactly when it is idempotent', () => {
    for (const { contract, replay } of routes) {
      const flagged = (contract as { idempotent?: true }).idempotent === true;
      expect(replay !== undefined, `${contract.method} ${contract.path}`).toBe(flagged);
    }
  });
});
