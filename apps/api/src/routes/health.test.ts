// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureLogs } from '../../test/support.ts';
import { createLogger } from '../logger.ts';
import { createServer } from '../server.ts';
import { createReadinessCheck, healthRoutes } from './health.ts';

// Building the server loads Fastify, which is slow on a cold start.
vi.setConfig({ testTimeout: 15_000 });

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function startApp(checkDatabase: () => Promise<void>, readinessTimeoutMs = 1000) {
  const logs = captureLogs();
  const server = createServer(createLogger({ level: 'info', destination: logs.stream }));
  app = server;
  await server.register(healthRoutes, {
    checkReadiness: createReadinessCheck(checkDatabase, readinessTimeoutMs),
  });
  return { app: server, logs };
}

describe('GET /health', () => {
  it('says the process is running, without asking the database', async () => {
    const checkDatabase = vi.fn(() => Promise.reject(new Error('the database is down')));
    const { app: server } = await startApp(checkDatabase);

    const response = await server.inject({ url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(checkDatabase).not.toHaveBeenCalled();
  });
});

describe('GET /health/ready', () => {
  it('answers 200 when the database answers', async () => {
    const checkDatabase = vi.fn(() => Promise.resolve());
    const { app: server } = await startApp(checkDatabase);

    const response = await server.inject({ url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
    expect(checkDatabase).toHaveBeenCalledOnce();
  });

  it('answers 503 when the database fails, without saying why, and logs the cause', async () => {
    const failure = Object.assign(
      new Error('password authentication failed for user "app_api" at 10.1.2.3:5432'),
      { code: '28P01' },
    );
    const { app: server, logs } = await startApp(() => Promise.reject(failure));

    const response = await server.inject({ url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', checks: { database: 'unavailable' } });
    expect(response.body).not.toContain('app_api');
    expect(response.body).not.toContain('10.1.2.3');

    const line = logs.lines().find((candidate) => candidate.msg === 'The database is not ready');
    expect(line).toMatchObject({
      level: 'warn',
      requestId: response.headers['x-request-id'],
      err: { code: '28P01' },
    });
  });

  it('answers 503 when the database does not answer in time', async () => {
    const { app: server } = await startApp(() => new Promise<void>(() => undefined), 20);

    const response = await server.inject({ url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', checks: { database: 'unavailable' } });
  });

  it('recovers when the database comes back', async () => {
    let up = false;
    const { app: server } = await startApp(() =>
      up ? Promise.resolve() : Promise.reject(new Error('down')),
    );

    expect((await server.inject({ url: '/health/ready' })).statusCode).toBe(503);
    up = true;
    expect((await server.inject({ url: '/health/ready' })).statusCode).toBe(200);
  });

  it('logs a change of state once, not every probe', async () => {
    let up = true;
    const { app: server, logs } = await startApp(() =>
      up ? Promise.resolve() : Promise.reject(new Error('down')),
    );
    const probe = () => server.inject({ url: '/health/ready' });
    const stateLines = () =>
      logs
        .lines()
        .filter((line) => line.msg?.startsWith('The database is'))
        .map((line) => [line.level, line.msg]);

    await probe();
    await probe();
    expect(stateLines()).toEqual([]);

    up = false;
    await probe();
    await probe();
    await probe();
    expect(stateLines()).toEqual([['warn', 'The database is not ready']]);

    up = true;
    await probe();
    await probe();
    expect(stateLines()).toEqual([
      ['warn', 'The database is not ready'],
      ['info', 'The database is ready again'],
    ]);
  });

  it('needs no sign-in and carries a request id', async () => {
    const { app: server } = await startApp(() => Promise.resolve());
    const response = await server.inject({ url: '/health/ready' });
    expect(response.headers['x-request-id']).toBeDefined();
  });
});

describe('createReadinessCheck', () => {
  it('shares one running check between callers instead of starting another', async () => {
    let finish: () => void = () => undefined;
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const ready = createReadinessCheck(check, 1000);

    const results = [ready(), ready(), ready()];
    finish();

    expect(await Promise.all(results)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(check).toHaveBeenCalledOnce();

    // The next probe, once the first has finished, asks again.
    const next = ready();
    finish();
    await next;
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('does not start another check while a slow one is still running', async () => {
    const check = vi.fn(() => new Promise<void>(() => undefined));
    const ready = createReadinessCheck(check, 10);

    expect((await ready()).ok).toBe(false);
    expect((await ready()).ok).toBe(false);
    expect(check).toHaveBeenCalledOnce();
  });

  it('turns a check that throws before it returns a promise into a failure', async () => {
    const ready = createReadinessCheck(() => {
      throw new Error('sync failure');
    }, 1000);
    expect(await ready()).toMatchObject({ ok: false });
  });
});
