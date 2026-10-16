// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { captureLogs } from '../test/support.ts';
import { createLogger } from './logger.ts';
import type { Problem } from './problems.ts';
import {
  BODY_LIMIT_BYTES,
  CONNECTION_TIMEOUT_MS,
  createServer,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
} from './server.ts';

// Building the server loads Fastify, which is slow on a cold start.
vi.setConfig({ testTimeout: 15_000 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = '0c7c3d1e-6c4e-4f4e-9d52-0e0a8d2c9a11';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A server with routes that validate their input and encode their output. */
async function startServer(logs = captureLogs()): Promise<FastifyInstance> {
  const server = createServer(createLogger({ level: 'info', destination: logs.stream }));
  app = server;
  const routes = server.withTypeProvider<ZodTypeProvider>();

  routes.post(
    '/things/:id',
    {
      schema: {
        params: z.strictObject({ id: z.uuid() }),
        querystring: z.strictObject({ page: z.coerce.number().int().min(1).optional() }),
        body: z.strictObject({
          title: z.string().min(3),
          amount: z.number().int().max(100),
          email: z.email(),
          tags: z.array(z.string()).min(1),
        }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    () => ({ ok: true }),
  );
  routes.get(
    '/extra-fields',
    { schema: { response: { 200: z.object({ ok: z.boolean() }) } } },
    () => ({ ok: true, internalNote: 'do not send', applicantEmail: 'jo@example.org' }),
  );

  await server.ready();
  return server;
}

function problemOf(body: string): Problem {
  return JSON.parse(body) as Problem;
}

const valid = { title: 'A title', amount: 5, email: 'jo@example.org', tags: ['a'] };

describe('validation of requests', () => {
  it('accepts a valid request', async () => {
    const server = await startServer();
    const response = await server.inject({
      method: 'POST',
      url: `/things/${ID}`,
      payload: valid,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('names each field and says what to fix, without repeating what was sent', async () => {
    const server = await startServer();
    const response = await server.inject({
      method: 'POST',
      url: `/things/${ID}`,
      payload: {
        title: 'ab',
        amount: 'sensitive-submitted-text',
        email: 'jo-at-example-SUBMITTED',
        tags: [],
        'x<script>alert(1)</script>': 'injected-value',
        extra: 'another-injected-value',
      },
    });
    const problem = problemOf(response.body);

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(problem.title).toBe('Bad Request');
    expect(problem.requestId).toBe(response.headers['x-request-id']);
    expect(problem.errors).toEqual(
      expect.arrayContaining([
        { field: 'body.title', message: 'Enter at least 3 characters.' },
        { field: 'body.amount', message: 'Enter a number.' },
        { field: 'body.email', message: 'Enter a valid email address.' },
        { field: 'body.tags', message: 'Add at least 1 item.' },
        { field: 'body.extra', message: 'This field is not accepted.' },
        { field: 'body.*', message: 'This field is not accepted.' },
      ]),
    );

    for (const echoed of ['sensitive-submitted', 'SUBMITTED', 'injected-value', 'script']) {
      expect(response.body).not.toContain(echoed);
    }
  });

  it('says which part of the request a problem is in', async () => {
    const server = await startServer();
    const badParams = await server.inject({
      method: 'POST',
      url: '/things/not-a-uuid',
      payload: valid,
    });
    expect(problemOf(badParams.body).errors).toEqual([
      { field: 'params.id', message: 'This id is not valid.' },
    ]);

    const badQuery = await server.inject({
      method: 'POST',
      url: `/things/${ID}?page=0`,
      payload: valid,
    });
    expect(problemOf(badQuery.body).errors).toEqual([
      { field: 'query.page', message: 'Enter 1 or more.' },
    ]);
  });

  it('refuses a body that is not JSON, without quoting it', async () => {
    const server = await startServer();
    const response = await server.inject({
      method: 'POST',
      url: `/things/${ID}`,
      headers: { 'content-type': 'application/json' },
      payload: '{"title": "jo.bloggs@example.org", oops',
    });

    expect(response.statusCode).toBe(400);
    expect(problemOf(response.body).detail).toBe(
      'The body is not valid JSON. Check it and try again.',
    );
    expect(response.body).not.toContain('jo.bloggs');
  });

  it.each(['application/xml', 'text/plain'])('refuses the content type %s', async (type) => {
    const server = await startServer();
    const response = await server.inject({
      method: 'POST',
      url: `/things/${ID}`,
      headers: { 'content-type': type },
      payload: 'jane@example.com',
    });

    expect(response.statusCode).toBe(415);
    expect(problemOf(response.body).title).toBe('Unsupported Media Type');
    expect(response.body).not.toContain('jane@example.com');
  });

  it('refuses a body over the size limit', async () => {
    const server = await startServer();
    const response = await server.inject({
      method: 'POST',
      url: `/things/${ID}`,
      payload: { ...valid, title: 'x'.repeat(1_100_000) },
    });

    expect(response.statusCode).toBe(413);
    expect(problemOf(response.body).detail).toBe('The request body is too large.');
  });
});

describe('limits on slow and large clients', () => {
  it('sets every time limit, so no client holds a connection open for ever', async () => {
    const server = await startServer();

    expect(server.server.requestTimeout).toBe(REQUEST_TIMEOUT_MS);
    expect(server.server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.server.timeout).toBe(CONNECTION_TIMEOUT_MS);
    for (const limit of [REQUEST_TIMEOUT_MS, HEADERS_TIMEOUT_MS, KEEP_ALIVE_TIMEOUT_MS]) {
      expect(limit).toBeGreaterThan(0);
    }
    // Node.js refuses a header time above the request time, and advises one above keep-alive.
    expect(HEADERS_TIMEOUT_MS).toBeLessThanOrEqual(REQUEST_TIMEOUT_MS);
    expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_TIMEOUT_MS);
  });

  it('refuses a body one byte over the default limit, and takes one at it', async () => {
    const server = createServer(createLogger({ level: 'silent' }));
    app = server;
    server
      .withTypeProvider<ZodTypeProvider>()
      .post('/blob', { schema: { body: z.object({ value: z.string() }) } }, () => 'ok');
    await server.ready();
    const send = (size: number) =>
      server.inject({
        method: 'POST',
        url: '/blob',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ value: 'x'.repeat(size - '{"value":""}'.length) }),
      });

    expect((await send(BODY_LIMIT_BYTES)).statusCode).toBe(200);
    expect((await send(BODY_LIMIT_BYTES + 1)).statusCode).toBe(413);
  });
});

describe('errors that carry headers', () => {
  async function failing(headers: Record<string, unknown>, statusCode = 429) {
    const server = createServer(createLogger({ level: 'silent' }));
    app = server;
    server.get('/limited', () => {
      throw Object.assign(new Error('Slow down.'), { statusCode, headers });
    });
    await server.ready();
    return server.inject({ url: '/limited' });
  }

  it('keep Retry-After and Allow, and nothing else', async () => {
    const response = await failing({
      'Retry-After': 30,
      allow: 'GET, HEAD',
      'set-cookie': 'session=stolen',
      location: 'https://example.org',
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    expect(response.headers['allow']).toBe('GET, HEAD');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['location']).toBeUndefined();
    expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
  });

  it('drop a value that could add a header line', async () => {
    const response = await failing({
      'retry-after': '30\r\nSet-Cookie: a=b',
      allow: 'GET\n',
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.headers['allow']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('send nothing for an error with no headers', async () => {
    const response = await failing({});

    expect(response.headers['retry-after']).toBeUndefined();
  });
});

describe('errors raised before a route runs', () => {
  it.each([
    ['a malformed URL', '/health/%E0%A4%A', 400, 'Bad Request'],
    ['a path parameter that is too long', `/things/${'a'.repeat(200)}`, 414, 'URI Too Long'],
  ])('answer %s with problem details', async (_name, url, status, title) => {
    const logs = captureLogs();
    const server = await startServer(logs);
    const response = await server.inject({ method: 'POST', url, payload: valid });
    const problem = problemOf(response.body);

    expect(response.statusCode).toBe(status);
    expect(response.headers['content-type']).toBe('application/problem+json; charset=utf-8');
    expect(problem).toMatchObject({ status, title, requestId: response.headers['x-request-id'] });
    expect(problem.requestId).toMatch(UUID);
    // Fastify's own message repeats the path.
    expect(response.body).not.toContain('%E0');
    expect(response.body).not.toContain('aaaa');

    const lines = logs.lines().filter((line) => line['requestId'] === problem.requestId);
    expect(lines.map((line) => line.msg)).toContain('The request was refused');
  });
});

describe('encoding of responses', () => {
  it('drops fields the response schema does not declare', async () => {
    const server = await startServer();
    const response = await server.inject({ url: '/extra-fields' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(response.body).not.toContain('internalNote');
    expect(response.body).not.toContain('jo@example.org');
  });
});

describe('request ids', () => {
  it('are new for every request, in the header and in a problem', async () => {
    const server = await startServer();
    const first = await server.inject({ url: '/extra-fields' });
    const second = await server.inject({ url: '/extra-fields' });

    expect(first.headers['x-request-id']).toMatch(UUID);
    expect(second.headers['x-request-id']).toMatch(UUID);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);

    const missing = await server.inject({ url: '/no-such-route' });
    expect(problemOf(missing.body).requestId).toBe(missing.headers['x-request-id']);
  });

  it('ignore an id sent by the caller', async () => {
    const server = await startServer();
    const response = await server.inject({
      url: '/no-such-route',
      headers: { 'x-request-id': 'chosen-by-caller', 'request-id': 'chosen-by-caller' },
    });

    expect(response.headers['x-request-id']).toMatch(UUID);
    expect(problemOf(response.body).requestId).toMatch(UUID);
  });
});
