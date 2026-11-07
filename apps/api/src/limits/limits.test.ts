// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The limit hooks through buildApp() with an in-memory counter store: what is
// limited, what a refusal looks like, whose address counts, and what is logged.

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureLogs } from '../../test/support.ts';
import { buildApp, type AppOptions } from '../app.ts';
import { Secret } from '../config.ts';
import type { PublicTenants } from '../database.ts';
import { createLogger } from '../logger.ts';
import { publicRoutes } from '../public/index.ts';
import { createServer } from '../server.ts';
import { recordRateLimitHit } from '../telemetry/index.ts';
import { clientNetwork, keyHash } from './client-key.ts';
import { LIMITS } from './definitions.ts';
import { registerLimits } from './index.ts';
import type { CounterStore } from './store.ts';

vi.mock('../telemetry/index.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordRateLimitHit: vi.fn(),
}));

const KEY = new Secret('a-key-of-at-least-thirty-two-bytes!');
const RETRY_AFTER = 17;
const CALLS_PER_GROUP = 2;

/** Counts in memory. Every counter starts at `start`, to reach a limit without sending all of it. */
function fakeStore(start = 0) {
  const counts = new Map<string, number>();
  const store: CounterStore & { counts: Map<string, number> } = {
    counts,
    count(bucket, key) {
      const id = `${bucket}:${key.toString('hex')}`;
      const count = (counts.get(id) ?? start) + 1;
      counts.set(id, count);
      return Promise.resolve({ count, retryAfter: RETRY_AFTER });
    },
  };
  return store;
}

const unreachable: CounterStore = { count: () => Promise.reject(new Error('connection refused')) };

const tenants = {
  tenant: vi.fn(() => Promise.resolve(undefined)),
  logo: () => Promise.resolve(undefined),
} satisfies PublicTenants;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.clearAllMocks();
});

async function start(options: Partial<AppOptions> & { store: CounterStore; now?: () => number }) {
  const { store, now, ...rest } = options;
  const logs = captureLogs();
  app = await buildApp({
    logger: createLogger({ level: 'info', destination: logs.stream }),
    checkDatabase: () => Promise.resolve(),
    routes: publicRoutes(tenants),
    limits: { store, key: KEY, ...(now && { now }) },
    ...rest,
  });
  return { server: app, logs };
}

const publicUrl = (slug: string) => `/api/public/tenants/${slug}`;

describe('the limits', () => {
  it('lets a request through while it is under its limit', async () => {
    const { server } = await start({ store: fakeStore(LIMITS.public.max - 1) });

    const response = await server.inject({ url: publicUrl('ada') });

    expect(response.statusCode).toBe(404);
    expect(tenants.tenant).toHaveBeenCalledTimes(1);
  });

  it('refuses with 429 and Retry-After, runs no handler, and echoes nothing of the request', async () => {
    const { server } = await start({ store: fakeStore(LIMITS.public.max) });

    const response = await server.inject({
      url: `${publicUrl('secret-slug')}?q=secret-query`,
      remoteAddress: '203.0.113.9',
      headers: { 'x-forwarded-for': '198.51.100.1', cookie: 'session=secret-cookie' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe(String(RETRY_AFTER));
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      type: 'about:blank',
      title: 'Too Many Requests',
      status: 429,
      detail: 'There have been too many requests. Wait a moment and try again.',
      requestId: expect.any(String) as string,
    });
    for (const echoed of ['secret', '203.0.113.9', '198.51.100.1', 'public', 'tenants']) {
      expect(response.body).not.toContain(echoed);
    }
    expect(tenants.tenant).not.toHaveBeenCalled();
  });

  it('counts a real, an unknown and a malformed slug on one counter', async () => {
    const store = fakeStore();
    const { server } = await start({ store });

    const codes = [];
    for (const slug of ['ada', 'no-such-tenant', 'Bad%20Slug!', 'x'.repeat(90)]) {
      codes.push((await server.inject({ url: publicUrl(slug) })).statusCode);
    }

    expect(codes).toEqual([404, 404, 404, 404]);
    expect([...store.counts.values()]).toEqual([4]);
  });

  it.each([
    ['/health', LIMITS.probe.max],
    ['/health/ready', LIMITS.probe.max],
    ['/openapi.json', LIMITS.openapi.max],
  ])('limits %s per address', async (url, max) => {
    const { server } = await start({ store: fakeStore(max) });

    const response = await server.inject({ url });

    expect(response.statusCode).toBe(429);
  });

  it('keeps the probe and OpenAPI counters apart', async () => {
    const store = fakeStore();
    const { server } = await start({ store });

    await server.inject({ url: '/health' });
    await server.inject({ url: '/openapi.json' });

    expect([...store.counts.values()]).toEqual([1, 1]);
  });

  it('applies the general limit to every other route, including an unknown one', async () => {
    const { server } = await start({ store: fakeStore(LIMITS.general_ip.max) });

    const response = await server.inject({ url: '/api/no-such-route' });

    expect(response.statusCode).toBe(429);
  });

  it('counts a signed-in user by their id and app, after the address, and refuses at its limit', async () => {
    const store = fakeStore();
    const server = createServer(createLogger({ level: 'silent' }));
    const limitSessions = registerLimits(server, { store, key: KEY });
    const read = vi.fn(() =>
      Promise.resolve({ app: 'console' as const, session: { userId: 'u1', app: 'console' } }),
    );
    const guarded = limitSessions(read as never);
    server.get('/x', async (request) => {
      await guarded(request);
      return {};
    });

    expect((await server.inject({ url: '/x' })).statusCode).toBe(200);

    const expected = keyHash(KEY, 'general_session', 'console:u1');
    expect(store.counts.get(`general:${expected.toString('hex')}`)).toBe(1);
    expect(store.counts.size).toBe(2);

    const busy = fakeStore(LIMITS.general_session.max);
    const second = createServer(createLogger({ level: 'silent' }));
    const guardedBusy = registerLimits(second, { store: busy, key: KEY })(read as never);
    second.get('/x', async (request) => {
      await guardedBusy(request);
      return {};
    });
    expect((await second.inject({ url: '/x' })).statusCode).toBe(429);
  });

  it('refuses on the address before it reads the session', async () => {
    const server = createServer(createLogger({ level: 'silent' }));
    const read = vi.fn();
    const guarded = registerLimits(server, { store: fakeStore(LIMITS.general_ip.max), key: KEY })(
      read,
    );
    server.get('/x', async (request) => {
      await guarded(request);
      return {};
    });

    expect((await server.inject({ url: '/x' })).statusCode).toBe(429);
    expect(read).not.toHaveBeenCalled();
  });

  it('calls the rate-limit hook once per refusal, with the limit and app only', async () => {
    const { server } = await start({ store: fakeStore(LIMITS.public.max) });

    await server.inject({ url: publicUrl('ada') });

    expect(recordRateLimitHit).toHaveBeenCalledOnce();
    expect(recordRateLimitHit).toHaveBeenCalledWith({ limit: 'public', app: 'none' });
  });

  it('sets no tenant: a public request runs with no tenant transaction', async () => {
    const inTenant = vi.fn();
    const { server } = await start({ store: fakeStore(), inTenant });

    await server.inject({ url: publicUrl('ada') });
    await server.inject({ url: '/health' });

    expect(inTenant).not.toHaveBeenCalled();
  });
});

describe('a refused key', () => {
  it('causes no further counter calls within its window, and Retry-After counts down', async () => {
    let time = 1_000_000;
    const store = fakeStore(LIMITS.public.max);
    const count = vi.spyOn(store, 'count');
    const { server } = await start({ store, now: () => time });

    const first = await server.inject({ url: publicUrl('ada') });
    time += 5000;
    const second = await server.inject({ url: publicUrl('ada') });
    for (let i = 0; i < 20; i++) await server.inject({ url: publicUrl('ada') });

    expect(first.headers['retry-after']).toBe(String(RETRY_AFTER));
    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBe(String(RETRY_AFTER - 5));
    expect(count).toHaveBeenCalledTimes(1);
    expect(tenants.tenant).not.toHaveBeenCalled();
    expect(recordRateLimitHit).toHaveBeenCalledTimes(22);

    time += RETRY_AFTER * 1000;
    await server.inject({ url: publicUrl('ada') });
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('is remembered for its own address only', async () => {
    const store = fakeStore(LIMITS.public.max);
    const count = vi.spyOn(store, 'count');
    const { server } = await start({ store });

    await server.inject({ url: publicUrl('ada'), remoteAddress: '203.0.113.9' });
    await server.inject({ url: publicUrl('ada'), remoteAddress: '203.0.113.10' });

    expect(count).toHaveBeenCalledTimes(2);
  });
});

describe('one client flooding the counters', () => {
  /** A store with a small connection pool: a call waits its turn, and gives up after 500 ms. */
  function pooledStore(connections = 4, callMs = 50) {
    let free = connections;
    const waiting: Array<() => void> = [];
    const store: CounterStore & { calls: number } = {
      calls: 0,
      async count() {
        store.calls++;
        if (free > 0) free--;
        else {
          await new Promise<void>((resolve, reject) => {
            const turn = () => {
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(() => {
              waiting.splice(waiting.indexOf(turn), 1);
              reject(new Error('connection timeout'));
            }, 500);
            waiting.push(turn);
          });
        }
        await new Promise((resolve) => setTimeout(resolve, callMs));
        const next = waiting.shift();
        if (next) next();
        else free++;
        return { count: 1, retryAfter: RETRY_AFTER };
      },
    };
    return store;
  }

  it('is refused from memory past its limit, makes about that many store calls, and leaves others served', async () => {
    const store = pooledStore();
    const { server } = await start({ store });
    const flood = Array.from({ length: 200 }, () =>
      server.inject({ url: '/openapi.json', remoteAddress: '203.0.113.9' }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    const other = await server.inject({ url: '/openapi.json', remoteAddress: '203.0.113.10' });
    const codes = (await Promise.all(flood)).map((response) => response.statusCode);

    expect(other.statusCode).toBe(200);
    expect(store.calls).toBeLessThanOrEqual(LIMITS.openapi.max + 1);
    expect(codes.filter((code) => code === 200)).toHaveLength(LIMITS.openapi.max);
    expect(codes.filter((code) => code === 429)).toHaveLength(200 - LIMITS.openapi.max);
    expect(codes).not.toContain(503);
  });

  it('counts requests whose store call failed, and refuses from memory past the limit', async () => {
    const count = vi.spyOn(unreachable, 'count');
    const { server } = await start({ store: unreachable });

    const codes = [];
    for (let i = 0; i < LIMITS.openapi.max + 10; i++) {
      codes.push((await server.inject({ url: '/openapi.json' })).statusCode);
    }

    expect(codes.filter((code) => code === 503)).toHaveLength(LIMITS.openapi.max);
    expect(codes.slice(LIMITS.openapi.max)).toEqual(Array<number>(10).fill(429));
    expect(count).toHaveBeenCalledTimes(LIMITS.openapi.max);
  });

  it('never has more than two store calls in progress for one key', async () => {
    let active = 0;
    let most = 0;
    const store: CounterStore = {
      async count() {
        most = Math.max(most, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { count: 1, retryAfter: RETRY_AFTER };
      },
    };
    const { server } = await start({ store });

    await Promise.all(Array.from({ length: 20 }, () => server.inject({ url: '/openapi.json' })));

    expect(most).toBe(2);
  });

  it('never has more than four store calls in progress across many keys', async () => {
    let active = 0;
    let most = 0;
    const store: CounterStore = {
      async count() {
        most = Math.max(most, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { count: 1, retryAfter: RETRY_AFTER };
      },
    };
    const { server } = await start({ store });

    const responses = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        server.inject({ url: '/openapi.json', remoteAddress: `203.0.113.${String(i + 1)}` }),
      ),
    );

    expect(most).toBe(4);
    expect(responses.map((response) => response.statusCode)).toEqual(Array<number>(40).fill(200));
  });

  it(
    'keeps a full key map from leaving a key untracked: a flood from one address stays bounded',
    { timeout: 30_000 },
    async () => {
      let calls = 0;
      let active = 0;
      let most = 0;
      const store: CounterStore = {
        async count() {
          calls++;
          most = Math.max(most, ++active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active--;
          return { count: 1, retryAfter: RETRY_AFTER };
        },
      };
      const { server } = await start({ store });
      // Many /64s from many /48s, so the key map fills to its limit.
      for (let batch = 0; batch < 20; batch++) {
        await Promise.all(
          Array.from({ length: 500 }, (_, i) =>
            server.inject({
              url: '/openapi.json',
              remoteAddress: `2001:db8:${(batch * 500 + i + 1).toString(16)}::1`,
            }),
          ),
        );
      }
      calls = 0;
      most = 0;

      const codes = (
        await Promise.all(
          Array.from({ length: 500 }, () =>
            server.inject({ url: '/openapi.json', remoteAddress: '203.0.113.9' }),
          ),
        )
      ).map((response) => response.statusCode);

      expect(calls).toBeLessThanOrEqual(LIMITS.openapi.max + 1);
      expect(most).toBeLessThanOrEqual(2);
      expect(codes.filter((code) => code === 429)).toHaveLength(500 - LIMITS.openapi.max);
    },
  );

  it('gives all the /64s of one IPv6 /48 two store calls in progress, and serves another network promptly', async () => {
    let active = 0;
    let most = 0;
    const store: CounterStore = {
      async count() {
        most = Math.max(most, ++active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return { count: 1, retryAfter: RETRY_AFTER };
      },
    };
    const { server } = await start({ store });
    const from48 = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        server.inject({
          url: '/openapi.json',
          remoteAddress: `2001:db8:1:${(i + 1).toString(16)}::1`,
        }),
      );

    await Promise.all(from48(60));
    expect(most).toBe(CALLS_PER_GROUP);

    const flood = from48(60);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const began = Date.now();
    const other = await server.inject({ url: '/openapi.json', remoteAddress: '203.0.113.10' });
    const waited = Date.now() - began;
    await Promise.all(flood);

    expect(other.statusCode).toBe(200);
    expect(waited).toBeLessThan(500);
  });

  it('frees its turn when a store call fails, so later keys are still served', async () => {
    let calls = 0;
    const store: CounterStore = {
      count() {
        return ++calls <= 8
          ? Promise.reject(new Error('connection refused'))
          : Promise.resolve({ count: 1, retryAfter: RETRY_AFTER });
      },
    };
    const { server } = await start({ store });

    const codes = [];
    for (let i = 0; i < 10; i++) {
      codes.push(
        (
          await server.inject({
            url: '/openapi.json',
            remoteAddress: `198.51.100.${String(i + 1)}`,
          })
        ).statusCode,
      );
    }

    expect(codes).toEqual([...Array<number>(8).fill(503), 200, 200]);
  });
});

describe('when the counters cannot be reached', () => {
  it('answers /health promptly when the counters never answer, and logs a security event', async () => {
    const never: CounterStore = { count: () => new Promise(() => undefined) };
    const { server, logs } = await start({ store: never });

    const started = performance.now();
    const response = await server.inject({ url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(logs.lines().find((line) => line.event === 'counter_store_unavailable')).toBeDefined();
  });

  it('answers /health as usual and logs a security event', async () => {
    const { server, logs } = await start({ store: unreachable });

    const response = await server.inject({ url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(logs.lines().find((line) => line.event === 'counter_store_unavailable')).toMatchObject({
      limit: 'probe',
      bucket: 'probe',
    });
  });

  it('answers 503 on every other route, and never lets the request through', async () => {
    const { server, logs } = await start({ store: unreachable });

    for (const url of ['/health/ready', '/openapi.json', publicUrl('ada'), '/api/unknown']) {
      const response = await server.inject({ url });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('connection refused');
    }
    expect(tenants.tenant).not.toHaveBeenCalled();
    expect(logs.text()).not.toContain('connection refused');
  });
});

describe('the client address', () => {
  const countedFor = (store: ReturnType<typeof fakeStore>, address: string) =>
    store.counts.get(`public:${keyHash(KEY, 'public', clientNetwork(address)).toString('hex')}`);

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    const store = fakeStore();
    const { server, logs } = await start({ store });

    await server.inject({
      url: publicUrl('ada'),
      remoteAddress: '203.0.113.9',
      headers: { 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' },
    });

    expect(countedFor(store, '203.0.113.9')).toBe(1);
    expect(countedFor(store, '198.51.100.1')).toBeUndefined();
    expect(logs.text()).not.toContain('198.51.100');
  });

  it('uses the address a trusted proxy forwards, and ignores a forged entry to its left', async () => {
    const store = fakeStore();
    const { server } = await start({ store, trustProxy: ['10.0.0.1'] });

    await server.inject({
      url: publicUrl('ada'),
      remoteAddress: '10.0.0.1',
      headers: { 'x-forwarded-for': '192.0.2.66, 203.0.113.9' },
    });

    expect(countedFor(store, '203.0.113.9')).toBe(1);
    expect(countedFor(store, '192.0.2.66')).toBeUndefined();
    expect(countedFor(store, '10.0.0.1')).toBeUndefined();
  });

  it('counts two addresses in one IPv6 /64 on one counter', async () => {
    const store = fakeStore();
    const { server } = await start({ store });

    await server.inject({ url: publicUrl('ada'), remoteAddress: '2001:db8:1:2::1' });
    await server.inject({ url: publicUrl('ada'), remoteAddress: '2001:db8:1:2:ffff::9' });
    await server.inject({ url: publicUrl('ada'), remoteAddress: '2001:db8:1:3::1' });

    expect([...store.counts.values()].sort()).toEqual([1, 2]);
  });
});

describe('security events', () => {
  it('logs a refusal with its code, limit, app, route template and client, and nothing else', async () => {
    const { server, logs } = await start({ store: fakeStore(LIMITS.public.max) });

    await server.inject({
      url: `${publicUrl('secret-slug')}?q=secret-query`,
      remoteAddress: '203.0.113.9',
      headers: {
        cookie: 'session=secret-cookie',
        authorization: 'Bearer secret-token',
        'user-agent': 'secret-agent',
      },
    });

    const events = logs.lines().filter((line) => line.event !== undefined);
    expect(events).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'rate_limit_reached',
        limit: 'public',
        bucket: 'public',
        app: 'none',
        route: '/api/public/tenants/:slug',
        client: '203.0.113.9',
        time: expect.any(String) as string,
      }),
    ]);
    expect(Object.keys(events[0] ?? {}).sort()).toEqual(
      [
        'app',
        'bucket',
        'client',
        'event',
        'level',
        'limit',
        'msg',
        'requestId',
        'route',
        'service',
        'time',
      ].sort(),
    );
    for (const secret of [
      'secret-slug',
      'secret-query',
      'secret-cookie',
      'secret-token',
      'secret-agent',
    ]) {
      expect(JSON.stringify(events)).not.toContain(secret);
    }
  });

  it('logs one event for a flood of refusals from one client', async () => {
    const { server, logs } = await start({ store: fakeStore(LIMITS.public.max) });

    for (let i = 0; i < 25; i++) await server.inject({ url: publicUrl('ada') });

    expect(logs.lines().filter((line) => line.event === 'rate_limit_reached')).toHaveLength(1);
  });

  it('keeps the client address out of ordinary request logs', async () => {
    const { server, logs } = await start({ store: fakeStore() });

    await server.inject({ url: publicUrl('ada'), remoteAddress: '203.0.113.9' });
    await server.inject({ url: '/health', remoteAddress: '203.0.113.9' });

    expect(logs.lines().length).toBeGreaterThan(0);
    expect(logs.text()).not.toContain('203.0.113.9');
  });
});
