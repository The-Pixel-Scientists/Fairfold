// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { captureLogs } from '../test/support.ts';
import { createLogger } from './logger.ts';
import type { Problem } from './problems.ts';
import { createServer } from './server.ts';

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
