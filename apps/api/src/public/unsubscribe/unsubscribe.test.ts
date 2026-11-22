// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The public unsubscribe routes with a fake store: what a bad token gets,
// that GET touches nothing, how the function's codes map to answers, the
// RFC 8058 form body, the headers, the limits, and that the token never
// reaches a log or a problem.

import { randomBytes, randomUUID } from 'node:crypto';

import { apiBasePath, defineRoute } from '@pixel-scientists/domain/api';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { captureLogs } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { Secret } from '../../config.ts';
import {
  signUnsubscribeToken,
  unsubscribeKeys,
  type UnsubscribeTarget,
} from '../../email/unsubscribe-token.ts';
import { LIMITS } from '../../limits/definitions.ts';
import type { CounterStore } from '../../limits/store.ts';
import { createLogger } from '../../logger.ts';
import { registerRoutes, route, type Route } from '../../routes/register.ts';
import { createServer } from '../../server.ts';
import { registerUnsubscribeTransport, unsubscribeRoutes } from './index.ts';
import type { UnsubscribeStore } from './store.ts';

const keys = unsubscribeKeys(new Map([[1, 'a-secret-of-at-least-thirty-two-characters']]), 1);
const otherKeys = unsubscribeKeys(new Map([[1, 'another-secret-of-at-least-thirty-two']]), 1);

const target = (change: Partial<UnsubscribeTarget> = {}): UnsubscribeTarget => ({
  tenantId: randomUUID(),
  personId: randomUUID(),
  purpose: 'future_funding',
  channel: 'email',
  address: { hash: randomBytes(32), keyVersion: 1 },
  ...change,
});

const URL = `${apiBasePath}/public/unsubscribe`;
const ONE_CLICK = 'List-Unsubscribe=One-Click';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function fakeStore(code = 'unsubscribed') {
  const record = vi.fn<UnsubscribeStore['record']>(() => Promise.resolve(code));
  const store: UnsubscribeStore = { record };
  return { store, record };
}

/** The routes as the API serves them: the form transport and the contract registration. */
async function start(store: UnsubscribeStore, others: readonly Route[] = []) {
  const logs = captureLogs();
  const server = createServer(createLogger({ level: 'info', destination: logs.stream }));
  await server.register(
    (scope) => {
      registerUnsubscribeTransport(scope);
      registerRoutes(scope, [...unsubscribeRoutes({ keys, store }), ...others], {
        readSession: () => Promise.resolve({ app: null, session: null }),
        inTenant: () => Promise.reject(new Error('No tenant transaction.')),
        resolvers: {},
      });
      return Promise.resolve();
    },
    { prefix: apiBasePath },
  );
  app = server;
  return { server, logs };
}

const withoutId = (body: unknown) => ({
  ...(body as Record<string, unknown>),
  requestId: undefined,
});

describe('a token that does not verify', () => {
  it('gets one answer however it is bad, and reaches no database', async () => {
    const { store, record } = fakeStore();
    const { server } = await start(store);
    const good = signUnsubscribeToken(keys, target());
    const flipped = `${good.slice(0, 20)}${good[20] === 'A' ? 'B' : 'A'}${good.slice(21)}`;
    const bad = [
      flipped,
      signUnsubscribeToken(otherKeys, target()),
      signUnsubscribeToken(keys, target(), new Date(Date.now() - 3 * 365 * 86_400_000)),
      good.slice(0, -4),
    ];

    for (const method of ['GET', 'POST'] as const) {
      const answers = [];
      for (const token of bad) {
        const response = await server.inject({
          method,
          url: `${URL}?token=${token}`,
          ...(method === 'POST' ? { headers: FORM, payload: ONE_CLICK } : {}),
        });
        answers.push({ status: response.statusCode, body: withoutId(response.json()) });
      }
      expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
      expect(answers[0]?.status).toBe(404);
    }
    expect(record).not.toHaveBeenCalled();
  });

  it('is the same answer as a person the database refuses', async () => {
    const { store } = fakeStore('refused');
    const { server } = await start(store);
    const forged = await server.inject({
      method: 'POST',
      url: `${URL}?token=${signUnsubscribeToken(otherKeys, target())}`,
      headers: FORM,
      payload: ONE_CLICK,
    });
    const unknownPerson = await server.inject({
      method: 'POST',
      url: `${URL}?token=${signUnsubscribeToken(keys, target())}`,
      headers: FORM,
      payload: ONE_CLICK,
    });

    expect(unknownPerson.statusCode).toBe(404);
    expect(withoutId(unknownPerson.json())).toEqual(withoutId(forged.json()));
  });

  it('is refused by the contract when it is not a token, and the problem does not repeat it', async () => {
    const { store, record } = fakeStore();
    const { server } = await start(store);

    const response = await server.inject({ url: `${URL}?token=not%20a%20token<script>` });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('script');
    expect(record).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('says what the link stops and nothing else, and changes nothing', async () => {
    const { store, record } = fakeStore();
    const { server } = await start(store);
    const found = target({ channel: 'sms' });

    const response = await server.inject({
      url: `${URL}?token=${signUnsubscribeToken(keys, found)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ purpose: 'future_funding', channel: 'sms' });
    for (const secret of [found.tenantId, found.personId]) {
      expect(response.body).not.toContain(secret);
    }
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it('sends headers that keep the token out of caches and Referer headers', async () => {
    const { store } = fakeStore();
    const { server } = await start(store);

    const answered = await server.inject({
      url: `${URL}?token=${signUnsubscribeToken(keys, target())}`,
    });
    const refused = await server.inject({
      url: `${URL}?token=${randomBytes(40).toString('base64url')}`,
    });

    for (const response of [answered, refused]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    }
  });
});

describe('POST', () => {
  it('records the token’s person, purpose and channel once, from the form body', async () => {
    const { store, record } = fakeStore();
    const { server } = await start(store);
    const found = target();

    const response = await server.inject({
      method: 'POST',
      url: `${URL}?token=${signUnsubscribeToken(keys, found)}`,
      headers: FORM,
      payload: ONE_CLICK,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'unsubscribed' });
    expect(response.headers['location']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toEqual(found);
    expect(record.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts the JSON form of the same body', async () => {
    const { store, record } = fakeStore();
    const { server } = await start(store);

    const response = await server.inject({
      method: 'POST',
      url: `${URL}?token=${signUnsubscribeToken(keys, target())}`,
      payload: { 'List-Unsubscribe': 'One-Click' },
    });

    expect(response.statusCode).toBe(200);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('answers a repeat as already unsubscribed', async () => {
    const { store } = fakeStore('already_unsubscribed');
    const { server } = await start(store);

    const response = await server.inject({
      method: 'POST',
      url: `${URL}?token=${signUnsubscribeToken(keys, target())}`,
      headers: FORM,
      payload: ONE_CLICK,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'already_unsubscribed' });
  });

  it.each([
    ['another value', 'List-Unsubscribe=Other'],
    ['an extra key', `${ONE_CLICK}&email=jo%40example.org`],
    ['a repeated key', `${ONE_CLICK}&${ONE_CLICK}`],
    ['no body', ''],
    ['another name', 'token=x'],
    ['a prototype key', `${ONE_CLICK}&__proto__=x`],
  ])('refuses %s and records nothing', async (_name, payload) => {
    const { store, record } = fakeStore();
    const { server } = await start(store);

    const response = await server.inject({
      method: 'POST',
      url: `${URL}?token=${signUnsubscribeToken(keys, target())}`,
      headers: FORM,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it('turns an unknown code from the database into the generic server error', async () => {
    const { store } = fakeStore('surprise');
    const { server } = await start(store);

    const response = await server.inject({
      method: 'POST',
      url: `${URL}?token=${signUnsubscribeToken(keys, target())}`,
      headers: FORM,
      payload: ONE_CLICK,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('surprise');
  });
});

describe('the form transport', () => {
  it('reads a form only for a one-click unsubscribe route', async () => {
    const other = defineRoute({
      audience: 'public',
      module: 'party',
      permission: null,
      scope: null,
      method: 'POST',
      path: '/public/other',
      summary: 'Another public route that takes a body',
      body: z.strictObject({ name: z.string() }),
      responses: { 200: z.strictObject({ name: z.string() }) },
    });
    const { store } = fakeStore();
    const { server } = await start(store, [
      route(other, ({ input }) => Promise.resolve(input.body)),
    ]);

    const response = await server.inject({
      method: 'POST',
      url: `${apiBasePath}/public/other`,
      headers: FORM,
      payload: 'name=Jo',
    });

    expect(response.statusCode).toBe(415);
  });
});

describe('the logs', () => {
  it('never hold the token', async () => {
    const { store } = fakeStore('refused');
    const { server, logs } = await start(store);
    const token = signUnsubscribeToken(keys, target());

    await server.inject({
      method: 'POST',
      url: `${URL}?token=${token}`,
      headers: FORM,
      payload: ONE_CLICK,
    });
    await server.inject({ url: `${URL}?token=${token}` });
    await server.inject({ url: `${URL}?token=${token.slice(0, -3)}%20` });

    expect(logs.text()).not.toContain(token);
    expect(logs.text()).not.toContain(token.slice(0, 40));
  });
});

describe('the limits', () => {
  const RETRY_AFTER = 30;
  const full = (): CounterStore => ({
    count: () => Promise.resolve({ count: LIMITS.public.max + 1, retryAfter: RETRY_AFTER }),
  });

  it('refuses a burst over the public limit before the token is read, whatever X-Forwarded-For says', async () => {
    const { store, record } = fakeStore();
    app = await buildApp({
      logger: createLogger({ level: 'silent' }),
      checkDatabase: () => Promise.resolve(),
      routes: unsubscribeRoutes({ keys, store }),
      limits: { store: full(), key: new Secret('a-key-of-at-least-thirty-two-bytes!') },
    });

    for (const forwarded of [undefined, '198.51.100.7', '192.0.2.1']) {
      const response = await app.inject({
        method: 'POST',
        url: `${URL}?token=${signUnsubscribeToken(keys, target())}`,
        payload: { 'List-Unsubscribe': 'One-Click' },
        ...(forwarded === undefined ? {} : { headers: { 'x-forwarded-for': forwarded } }),
      });
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe(String(RETRY_AFTER));
    }
    expect(record).not.toHaveBeenCalled();
  });
});
