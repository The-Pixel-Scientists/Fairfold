// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Raw upload routes (ADR 0047), the steps that need no database: what is
// checked before the body is read. A request that reaches the database is told
// apart by a transaction that answers 409. The steps after the policy, with
// real files, are in platform/files/files.integration.test.ts.

import { Readable } from 'node:stream';

import { defineRoute } from '@pixel-scientists/domain/api';
import { encodeFileNameHeader } from '@pixel-scientists/domain/files';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { testAuth, testSession } from '../../test/support.ts';
import { buildApp } from '../app.ts';
import type { TenantTransaction } from '../database.ts';
import { createLogger } from '../logger.ts';
import type { FileRequest, FileService } from '../platform/files/index.ts';
import { ApiError } from '../problems.ts';
import { route } from './register.ts';

vi.setConfig({ testTimeout: 15_000 });

const upload = defineRoute({
  method: 'POST',
  path: '/console/upload-check',
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
  summary: 'Take a file',
  body: { raw: ['application/octet-stream'], maxBytes: 1000 },
  responses: { 200: z.object({ ok: z.boolean() }) },
});

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function build() {
  const auth = testAuth();
  const transactions = vi.fn(() => Promise.reject(new ApiError(409, 'The policy let it through.')));
  const handler = vi.fn(() => Promise.resolve({ ok: true }));
  const app = await buildApp({
    logger: createLogger({ level: 'silent' }),
    checkDatabase: () => Promise.resolve(),
    inTenant: transactions,
    auth: auth.module,
    routes: [route(upload, handler)],
  });
  apps.push(app);
  const signedIn = auth.as({ app: 'console', session: testSession({ app: 'console' }) });
  const post = (headers: Record<string, string>, payload: Buffer | string = Buffer.from('%PDF-')) =>
    app.inject({
      method: 'POST',
      url: '/api/console/upload-check',
      headers: { 'content-type': 'application/octet-stream', ...headers },
      payload,
    });
  return { app, post, signedIn, transactions, handler };
}

describe('a raw upload route', () => {
  it('turns a signed-out caller away before it reads the name or the body', async () => {
    const { post, transactions, handler } = await build();
    const response = await post({ 'file-name': encodeFileNameHeader('Accounts.pdf') });
    expect(response.statusCode).toBe(401);
    expect(transactions).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a missing or bad name with a 400 that does not repeat it', async () => {
    const { post, signedIn, transactions } = await build();
    const missing = await post({ ...signedIn });
    expect(missing.statusCode).toBe(400);
    for (const name of ['secret%2Fjo.pdf', 'secret%00jo.pdf', 'secret jo.pdf', '%E0%A4%A']) {
      const response = await post({ ...signedIn, 'file-name': name });
      expect(response.statusCode, name).toBe(400);
      expect(response.body).not.toContain('secret');
      expect(response.json<{ detail: string }>().detail).toContain('File-Name');
    }
    expect(transactions).not.toHaveBeenCalled();
  });

  it('checks the policy before the body is read, and hands the handler nothing yet', async () => {
    const { post, signedIn, transactions, handler } = await build();
    const response = await post({ ...signedIn, 'file-name': encodeFileNameHeader('Accounts.pdf') });
    expect(response.statusCode).toBe(409);
    expect(transactions).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it('is described in the OpenAPI document as raw bytes with their limit', async () => {
    const { app } = await build();
    const document = (await app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, { post: { requestBody: unknown } }>;
    }>();
    expect(document.paths['/api/console/upload-check']?.post.requestBody).toMatchObject({
      required: true,
      content: { 'application/octet-stream': { schema: { 'x-max-bytes': 1000 } } },
    });
  });
});

const download = defineRoute({
  method: 'GET',
  path: '/console/download-check/:fileId',
  audience: 'console',
  module: 'platform',
  permission: 'platform.settings.manage',
  scope: 'tenant',
  summary: 'Send a file',
  params: z.strictObject({ fileId: z.uuid() }),
  responses: { 200: { raw: ['application/pdf'] } },
});

const MEMBER = '22222222-2222-4222-8222-222222222222';

/** A transaction whose every query answers `row`: enough for the policy's membership lookup. */
const answering = (row: unknown): TenantTransaction => {
  const chain: object = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'executeTakeFirst' ? () => Promise.resolve(row) : () => chain,
    },
  );
  return { $extendTables: () => chain } as unknown as TenantTransaction;
};

describe('a raw upload route with the policy satisfied', () => {
  async function buildAllowed() {
    const auth = testAuth();
    const bound: FileRequest[] = [];
    const taken: { name: string; bytes: Buffer }[] = [];
    const files: FileService = (request) => {
      bound.push(request);
      return {
        store: () => Promise.reject(new Error('unused')),
        send: () => Promise.reject(new Error('unused')),
      };
    };
    const session = testSession({ app: 'console' });
    const app = await buildApp({
      logger: createLogger({ level: 'silent' }),
      checkDatabase: () => Promise.resolve(),
      inTenant: (_tenant, work) => work(answering({ id: MEMBER, roles: ['tenant_admin'] })),
      auth: auth.module,
      files,
      routes: [
        route(upload, ({ input }) => {
          taken.push(input.body);
          return Promise.resolve({ ok: true });
        }),
        route(download, () =>
          Promise.resolve({
            type: 'application/pdf' as const,
            body: Readable.from([Buffer.from('%PDF-1.7 bytes')]),
            headers: {
              'content-security-policy': "default-src 'none'; sandbox",
              'cross-origin-resource-policy': 'same-origin',
              'content-disposition': 'attachment; filename="a.pdf"',
            },
          }),
        ),
      ],
    });
    apps.push(app);
    const headers = auth.as({ app: 'console', session });
    return { app, headers, bound, taken, session };
  }

  const post = (
    { app, headers }: Awaited<ReturnType<typeof buildAllowed>>,
    payload: Buffer | string,
    extra: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/console/upload-check',
      headers: {
        ...headers,
        'content-type': 'application/octet-stream',
        'file-name': encodeFileNameHeader('Budget 2026 – final.pdf'),
        ...extra,
      },
      payload,
    });

  it('gives the handler the decoded name, the bytes and the file service bound to the request', async () => {
    const t = await buildAllowed();
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 255, 10]);
    expect((await post(t, bytes)).json()).toEqual({ ok: true });
    expect(t.taken).toEqual([{ name: 'Budget 2026 – final.pdf', bytes }]);
    expect(t.bound).toHaveLength(1);
    expect(t.bound[0]).toMatchObject({ tenant: t.session.tenant, membershipId: MEMBER });
  });

  it('refuses a body over the route’s limit, and a body that is not octet-stream', async () => {
    const t = await buildAllowed();
    expect((await post(t, Buffer.alloc(1001))).statusCode).toBe(413);
    expect((await post(t, Buffer.alloc(1000))).statusCode).toBe(200);
    const json = await post(t, '{"name":"a.pdf"}', { 'content-type': 'application/json' });
    expect(json.statusCode).toBe(415);
    expect(t.taken).toHaveLength(1);
  });

  it('streams a raw answer with the headers the handler sets in place of the defaults', async () => {
    const t = await buildAllowed();
    const response = await t.app.inject({
      url: '/api/console/download-check/33333333-3333-4333-8333-333333333333',
      headers: t.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('%PDF-1.7 bytes');
    expect(response.headers).toMatchObject({
      'content-type': 'application/pdf',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
      'content-disposition': 'attachment; filename="a.pdf"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
  });
});
