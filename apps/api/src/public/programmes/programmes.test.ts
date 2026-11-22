// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The browsing routes with the function stubbed: the mapping, the one 404,
// what is never echoed or sent, and the public limit in front of them.

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureLogs } from '../../../test/support.ts';
import { buildApp } from '../../app.ts';
import { Secret } from '../../config.ts';
import type { PublicTenants } from '../../database.ts';
import { LIMITS } from '../../limits/definitions.ts';
import type { CounterStore } from '../../limits/store.ts';
import { createLogger } from '../../logger.ts';
import { publicRoutes } from '../index.ts';
import type { OpenRoundRow } from './open-rounds.ts';

const ROUND = '0198a8d2-0000-7000-8000-000000000001';
const OTHER = '0198a8d2-0000-7000-8000-000000000002';
const ABSENT = '0198a8d2-0000-7000-8000-0000000000ff';

const row = (id: string, overrides: Partial<OpenRoundRow> = {}): OpenRoundRow => ({
  round_id: id,
  programme_title: 'Programme A',
  programme_summary: 'Grants for synthetic test groups.',
  round_title: 'Round 1',
  opens_at: new Date('2027-01-04T09:00:00Z'),
  closes_at: new Date('2027-02-01T17:00:00Z'),
  timezone: 'Europe/London',
  award_min_minor: '10000',
  award_max_minor: '500000',
  currency: 'GBP',
  eligibility: [{ label: 'Are you a charity?', explanation: 'Only charities can apply.' }],
  ...overrides,
});

const rounds = vi.fn((slug: string): Promise<readonly OpenRoundRow[]> =>
  Promise.resolve(slug === 'tenant-a' ? [row(ROUND), row(OTHER)] : []),
);
const tenants: PublicTenants = {
  tenant: () => Promise.resolve(undefined),
  logo: () => Promise.resolve(undefined),
  rounds,
  embedOrigins: (slug) =>
    Promise.resolve(slug === 'tenant-a' ? ['https://funder.example.org'] : []),
};

const passing: CounterStore = { count: () => Promise.resolve({ count: 1, retryAfter: 9 }) };
const full: CounterStore = {
  count: () => Promise.resolve({ count: LIMITS.public.max + 1, retryAfter: 9 }),
};
const unreachable: CounterStore = { count: () => Promise.reject(new Error('connection refused')) };

// The first request builds the application, which is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.clearAllMocks();
});

async function start(store: CounterStore = passing, source: PublicTenants = tenants) {
  const logs = captureLogs();
  app = await buildApp({
    logger: createLogger({ level: 'info', destination: logs.stream }),
    checkDatabase: () => Promise.resolve(),
    routes: publicRoutes(source),
    limits: { store, key: new Secret('a-key-of-at-least-thirty-two-bytes!') },
  });
  return { server: app, logs };
}

const url = (slug: string, rest = 'rounds') => `/api/public/tenants/${slug}/${rest}`;

/** What an answer shows a stranger, without what is meant to differ between requests. */
const shown = (response: LightMyRequestResponse) => ({
  status: response.statusCode,
  body: { ...response.json<Record<string, unknown>>(), requestId: undefined },
  headers: { ...response.headers, date: undefined, 'x-request-id': undefined },
});

describe('the open rounds list', () => {
  it('maps each row to the public shape and nothing else', async () => {
    const { server } = await start();

    const response = await server.inject({ url: url('tenant-a') });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      rounds: [ROUND, OTHER].map((id) => ({
        id,
        title: 'Round 1',
        programme: { title: 'Programme A', summary: 'Grants for synthetic test groups.' },
        opensAt: '2027-01-04T09:00:00.000Z',
        closesAt: '2027-02-01T17:00:00.000Z',
        timeZone: 'Europe/London',
        awardMinimum: { amountMinor: 10_000, currency: 'GBP' },
        awardMaximum: { amountMinor: 500_000, currency: 'GBP' },
        eligibility: [{ label: 'Are you a charity?', explanation: 'Only charities can apply.' }],
      })),
    });
    expect(rounds).toHaveBeenCalledExactlyOnceWith('tenant-a');
  });

  it('sends no cookie, is never cached and is not sniffed, session cookie or not', async () => {
    const { server } = await start();

    const plain = await server.inject({ url: url('tenant-a') });
    const signedIn = await server.inject({
      url: url('tenant-a'),
      headers: { cookie: 'session=a-valid-looking-session' },
    });

    expect(signedIn.headers['set-cookie']).toBeUndefined();
    expect(signedIn.headers['cache-control']).toBe('no-store');
    expect(signedIn.headers['x-content-type-options']).toBe('nosniff');
    expect(signedIn.body).toBe(plain.body);
  });

  it('sends none of the fields a stranger must not read', async () => {
    const { server } = await start();
    const text = (await server.inject({ url: url('tenant-a') })).body.toLowerCase();

    for (const field of [
      'tenant',
      'programmeid',
      'description',
      'budget',
      'latepolicy',
      'status',
      'stage',
      'rubric',
      'template',
      'definition',
      'count',
      'history',
      'membership',
      'userid',
      'partyid',
      'decision',
      'reviewer',
    ]) {
      expect(text).not.toContain(field);
    }
  });
});

describe('one open round', () => {
  it('reads a round the list holds, from the same single function call', async () => {
    const { server } = await start();

    const response = await server.inject({ url: url('tenant-a', `rounds/${OTHER}`) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: OTHER, title: 'Round 1' });
    expect(rounds).toHaveBeenCalledExactlyOnceWith('tenant-a');
  });
});

describe('not found', () => {
  const cases = [
    ['an unknown slug', url('no-such-tenant')],
    ['a tenant with nothing open', url('tenant-empty')],
    ['a differently cased slug', url('Tenant-A')],
    ['a malformed slug', url('bad_slug!')],
    ['an unknown slug on the round route', url('no-such-tenant', `rounds/${ROUND}`)],
    ['a round that is not listed', url('tenant-a', `rounds/${ABSENT}`)],
    ['a malformed round id', url('tenant-a', 'rounds/not-a-uuid')],
  ] as const;

  it('answers every case with one 404, word for word and header for header', async () => {
    const { server } = await start();
    const answers = await Promise.all(cases.map(([, path]) => server.inject({ url: path })));

    const [first] = answers;
    for (const response of answers) {
      expect(response.statusCode).toBe(404);
      expect(shown(response)).toEqual(shown(first as LightMyRequestResponse));
    }
  });

  it('never repeats the slug, the round id or the path, in the answer or the log', async () => {
    const { server, logs } = await start();
    const slug = 'recognisable-slug';
    const id = '0198a8d2-aaaa-7000-8000-00000000beef';

    const paths = [url(slug), url(slug, `rounds/${id}`), url('tenant-a', `rounds/${id}`)];
    const answers = [
      ...(await Promise.all(paths.map((path) => server.inject({ url: path })))),
      await server.inject({ url: `${url('tenant-a')}?q=secret-query` }),
    ];

    expect(answers.map((response) => response.statusCode)).toEqual([404, 404, 404, 400]);
    for (const response of answers) {
      for (const echoed of [slug, id, 'secret-query', 'tenants']) {
        expect(response.body).not.toContain(echoed);
      }
    }
    // The request logger shows a route's own path on its first line (not mine to change);
    // nothing else the request writes repeats it, and no line holds a query value.
    const later = JSON.stringify(logs.lines().filter((line) => line.msg !== 'incoming request'));
    for (const echoed of [slug, id]) expect(later).not.toContain(echoed);
    expect(logs.text()).not.toContain('secret-query');
  });
});

describe('a row that fails its schema', () => {
  it('answers the generic 500 with nothing from the row in the body or the log', async () => {
    const source = {
      ...tenants,
      rounds: () =>
        Promise.resolve([row(ROUND, { programme_title: 'leaked-title', currency: 'XXX' })]),
    };
    const { server, logs } = await start(passing, source);

    const response = await server.inject({ url: url('tenant-a') });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('leaked-title');
    expect(logs.text()).not.toContain('leaked-title');
  });
});

describe('the limits', () => {
  it('refuses with 429 and Retry-After, and never calls the function', async () => {
    const { server } = await start(full);

    for (const path of [
      url('tenant-a'),
      url('tenant-a', `rounds/${ROUND}`),
      url('tenant-a', 'embed-origins'),
    ]) {
      const response = await server.inject({ url: path });
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('9');
    }
    expect(rounds).not.toHaveBeenCalled();
  });

  it('answers 503, never an unlimited request, when the counter store fails', async () => {
    const { server } = await start(unreachable);

    for (const path of [url('tenant-a'), url('tenant-a', 'embed-origins')]) {
      expect((await server.inject({ url: path })).statusCode).toBe(503);
    }
    expect(rounds).not.toHaveBeenCalled();
  });
});

describe('the embed origins read', () => {
  it('lists origins only, and gives a tenant with none the one 404', async () => {
    const { server } = await start();

    const found = await server.inject({ url: url('tenant-a', 'embed-origins') });
    const none = await server.inject({ url: url('tenant-empty', 'embed-origins') });
    const malformed = await server.inject({ url: url('Bad_Slug', 'embed-origins') });

    expect(found.json()).toEqual({ origins: ['https://funder.example.org'] });
    expect(found.headers['set-cookie']).toBeUndefined();
    expect(none.statusCode).toBe(404);
    expect(shown(malformed)).toEqual(shown(none));
  });
});
