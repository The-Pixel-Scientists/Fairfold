// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { captureLogs } from '../test/support.ts';
import { createLogger } from './logger.ts';
import { ApiError, PROBLEM_CONTENT_TYPE, type Problem } from './problems.ts';
import { createServer } from './server.ts';

// Building the server loads Fastify, which is slow on a cold start.
vi.setConfig({ testTimeout: 15_000 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A server with the API's error handling and routes that fail in different ways. */
async function startServer() {
  const logs = captureLogs();
  const server = createServer(createLogger({ level: 'info', destination: logs.stream }));
  app = server;
  const routes = server.withTypeProvider<ZodTypeProvider>();

  routes.get('/boom', () => {
    throw new Error(
      'connection to 10.0.0.5:5432 refused for user app_api with password hunter2-internal',
    );
  });
  routes.get('/database-error', () => {
    throw Object.assign(
      new Error('duplicate key value violates unique constraint "uq_users_email"'),
      {
        code: '23505',
        detail: 'Key (email)=(jo.bloggs@example.org) already exists.',
        constraint: 'uq_users_email',
        statusCode: 409,
      },
    );
  });
  routes.get('/client-error-with-value', () => {
    throw Object.assign(new Error('Invalid value "jo.bloggs@example.org" for amount'), {
      statusCode: 400,
    });
  });
  routes.get('/refused', () => {
    throw new ApiError(403, 'You cannot release decisions for this round.');
  });
  routes.get('/refused-with-fields', () => {
    throw new ApiError(422, 'Fix the fields listed and try again.', {
      errors: [{ field: 'body.answers.f_0a1b', message: 'Enter a date after 1 April 2027.' }],
    });
  });
  routes.get('/non-error', () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the handler must cope with it
    throw 'plain string with a secret';
  });
  routes.get(
    '/declared-error',
    { schema: { response: { 400: z.object({ unrelated: z.string() }) } } },
    () => {
      throw new ApiError(400, 'This request is not valid.');
    },
  );
  routes.get(
    '/mismatch',
    { schema: { response: { 200: z.object({ ok: z.boolean() }) } } },
    () => ({ ok: 'maybe' }) as unknown as { ok: boolean },
  );

  await server.ready();
  return { server, logs };
}

function problemOf(body: string): Problem {
  return JSON.parse(body) as Problem;
}

describe('the error handler', () => {
  it('hides an unexpected error, and logs it with the request id', async () => {
    const { server, logs } = await startServer();
    const response = await server.inject({ url: '/boom' });
    const problem = problemOf(response.body);

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toBe(PROBLEM_CONTENT_TYPE);
    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: expect.stringContaining('Something went wrong on our side') as string,
      requestId: response.headers['x-request-id'],
    });
    expect(problem.requestId).toMatch(UUID);

    // Nothing from the error or the code that threw it.
    for (const leak of ['hunter2', '10.0.0.5', 'app_api', 'stack', 'node_modules', '.ts:']) {
      expect(response.body).not.toContain(leak);
    }

    const line = logs.lines().find((candidate) => candidate.msg === 'The request failed');
    expect(line).toMatchObject({
      level: 'error',
      requestId: problem.requestId,
      err: { type: 'Error' },
    });
  });

  it('never sends a database error, its constraint or its values', async () => {
    const { server, logs } = await startServer();
    const response = await server.inject({ url: '/database-error' });

    expect(response.statusCode).toBe(409);
    expect(problemOf(response.body).detail).toBe(
      'This conflicts with the current state. Reload and try again.',
    );
    for (const leak of ['uq_users_email', 'jo.bloggs', '23505', 'duplicate key']) {
      expect(response.body).not.toContain(leak);
    }
    // The values are not in the log either.
    expect(logs.text()).not.toContain('jo.bloggs');
  });

  it('uses the generic text for a client error, not the error message', async () => {
    const { server } = await startServer();
    const response = await server.inject({ url: '/client-error-with-value' });

    expect(response.statusCode).toBe(400);
    expect(problemOf(response.body).detail).toBe(
      'We could not read the request. Check it and try again.',
    );
    expect(response.body).not.toContain('jo.bloggs');
  });

  it('copes with something that is not an error', async () => {
    const { server } = await startServer();
    const response = await server.inject({ url: '/non-error' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('plain string');
  });

  it('sends the text of an error thrown on purpose', async () => {
    const { server } = await startServer();
    const refused = await server.inject({ url: '/refused' });
    expect(refused.statusCode).toBe(403);
    expect(problemOf(refused.body)).toMatchObject({
      title: 'Forbidden',
      status: 403,
      detail: 'You cannot release decisions for this round.',
    });

    const withFields = await server.inject({ url: '/refused-with-fields' });
    expect(withFields.statusCode).toBe(422);
    expect(problemOf(withFields.body).errors).toEqual([
      { field: 'body.answers.f_0a1b', message: 'Enter a date after 1 April 2027.' },
    ]);
  });

  it('answers an unknown route like any other error', async () => {
    const { server } = await startServer();
    const response = await server.inject({ url: '/no-such-route' });
    const problem = problemOf(response.body);

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toBe(PROBLEM_CONTENT_TYPE);
    expect(problem).toMatchObject({
      title: 'Not Found',
      status: 404,
      detail: 'We could not find what you asked for.',
      requestId: response.headers['x-request-id'],
    });
    // The path is not repeated back.
    expect(response.body).not.toContain('no-such-route');
  });

  it('keeps the problem shape when the route declares a response for that status', async () => {
    const { server } = await startServer();
    const response = await server.inject({ url: '/declared-error' });

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toBe(PROBLEM_CONTENT_TYPE);
    expect(problemOf(response.body)).toMatchObject({
      status: 400,
      detail: 'This request is not valid.',
    });
  });

  it('answers a response that does not match its schema with a generic error', async () => {
    const { server } = await startServer();
    const response = await server.inject({ url: '/mismatch' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('maybe');
    expect(response.body).not.toContain("doesn't match");
    expect(problemOf(response.body).detail).toContain('Something went wrong on our side');
  });
});
