// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureLogs } from '../test/support.ts';
import { createLogger } from './logger.ts';
import { createServer } from './server.ts';

// Building the server loads Fastify, which is slow on a cold start.
vi.setConfig({ testTimeout: 15_000 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

function startServer(level: 'info' | 'debug' = 'info') {
  const logs = captureLogs();
  const app = createServer(createLogger({ level, destination: logs.stream }));
  server = app;
  return { app, logs };
}

describe('the lines a request writes', () => {
  it('all carry the request id, which is also the response header', async () => {
    const { app, logs } = startServer('debug');
    app.get('/hello', (request) => {
      request.log.info({ step: 'handler' }, 'Inside the handler');
      return { ok: true };
    });
    const response = await app.inject({ url: '/hello' });
    const requestId = response.headers['x-request-id'];

    expect(requestId).toMatch(UUID);
    const lines = logs.lines();
    expect(lines.map((line) => line.msg)).toEqual(
      expect.arrayContaining(['incoming request', 'Inside the handler', 'request completed']),
    );
    for (const line of lines) {
      expect(line['requestId']).toBe(requestId);
    }
  });

  it('carry a different id for each request', async () => {
    const { app, logs } = startServer();
    app.get('/hello', () => ({ ok: true }));
    await app.inject({ url: '/hello' });
    await app.inject({ url: '/hello' });

    const ids = new Set(logs.lines().map((line) => line['requestId']));
    expect(ids.size).toBe(2);
  });

  it('say the method and path of the request, and the status of the response', async () => {
    const { app, logs } = startServer();
    app.get('/hello', () => ({ ok: true }));
    await app.inject({ url: '/hello?page=2' });

    const lines = logs.lines();
    expect(lines.find((line) => line.msg === 'incoming request')).toMatchObject({
      req: { method: 'GET', url: '/hello?page' },
    });
    expect(lines.find((line) => line.msg === 'request completed')).toMatchObject({
      res: { statusCode: 200 },
    });
  });

  it('do not hold the headers of the request', async () => {
    const { app, logs } = startServer('debug');
    app.get('/hello', () => ({ ok: true }));
    await app.inject({
      url: '/hello',
      headers: { authorization: 'Bearer SECRET-TOKEN', cookie: 'session=SECRET-COOKIE' },
    });

    expect(logs.text()).not.toContain('SECRET');
    expect(logs.lines().map((line) => line.msg)).toContain('incoming request');
  });

  it('do not hold the address of the caller', async () => {
    const { app, logs } = startServer();
    app.get('/hello', () => ({ ok: true }));
    await app.inject({ url: '/hello', remoteAddress: '203.0.113.9' });

    expect(logs.text()).not.toContain('203.0.113.9');
  });

  it('do not hold the tokens in the path or query of an auth route', async () => {
    const { app, logs } = startServer();
    app.get('/api/auth/reset-password/:token', () => ({ ok: true }));
    await app.inject({ url: '/api/auth/reset-password/SECRET-TOKEN?code=SECRET-CODE' });
    await app.inject({ url: '/api/auth/unknown/SECRET-HANDLE' });

    expect(logs.text()).not.toContain('SECRET');
    expect(logs.text()).toContain('/api/auth/reset-password/:token');
  });

  it('hold the keys of a query and never its values', async () => {
    const { app, logs } = startServer();
    app.get('/applications', () => ({ ok: true }));
    await app.inject({ url: '/applications?page=2&q=jo.bloggs%40example.org' });

    expect(logs.text()).not.toContain('jo.bloggs');
    expect(logs.text()).not.toContain('page=2');
    expect(logs.text()).toContain('/applications?page&q');
  });

  it('do not hold the tokens of an auth route whose path is percent-encoded', async () => {
    const { app, logs } = startServer();
    app.get('/auth/reset/:token', () => ({ ok: true }));
    await app.inject({ url: '/%61uth/reset/SECRET-TOKEN?code=SECRET-CODE' });
    await app.inject({ url: '/%61uth/other/SECRET-HANDLE' });

    expect(logs.text()).not.toContain('SECRET');
    expect(logs.lines().filter((line) => line.msg === 'incoming request')).toHaveLength(2);
  });

  it('show a placeholder for a request that matched no route, whatever its path looks like', async () => {
    const { app, logs } = startServer();
    app.get('/auth/reset/:token', () => ({ ok: true }));
    for (const url of [
      '//auth/reset/SECRET-TOKEN',
      '/api//auth/reset/SECRET-TOKEN',
      '/auth;a/reset/SECRET-TOKEN',
      '/no-such-route?email=SECRET-EMAIL',
      '/health/%E0%A4%A/SECRET-TOKEN',
    ]) {
      await app.inject({ url });
    }

    expect(logs.text()).not.toContain('SECRET');
    const incoming = logs.lines().filter((line) => line.msg === 'incoming request');
    expect(incoming).toHaveLength(5);
    for (const line of incoming) {
      expect(line['req']).toMatchObject({ url: '[no route]' });
    }
  });

  it('hold a query key only if it looks like a parameter name', async () => {
    const { app, logs } = startServer();
    app.get('/applications', () => ({ ok: true }));
    await app.inject({ url: '/applications?page=2&jane@example.com&jane%40example.com=1' });

    expect(logs.text()).not.toContain('jane');
    expect(logs.text()).toContain('/applications?page&[redacted]&[redacted]');
  });
});
