// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The request limits as Fastify hooks (S11-36). Every request is counted per
// client address in an onRequest hook, before anything else reads it; a
// signed-in request is also counted per user, right after readSession() has
// found the session. Both come before the body is parsed or validated.
//
//   /health, /health/ready   probe        per address
//   /openapi.json            openapi      per address
//   routes with no sign-in   public       per address (/public/tenants/*)
//   everything else          general_ip   per address, then general_session
//
// A refusal is a 429 with Retry-After, and nothing else happens. A refused key
// is remembered in memory until its window ends, so a client that keeps
// sending costs no further counter call. Each key is also counted in memory,
// requests whose counter call failed included, and at most two counter calls
// per key run at once, so one client cannot fill the connection pool and turn
// everyone else away. If the counters cannot be reached the request gets a
// 503, never a free pass, except /health, which never depends on the database:
// it waits for the counters only a moment.

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Secret } from '../config.ts';
import type { SessionRead } from '../context.ts';
import { ApiError } from '../problems.ts';
import { recordRateLimitHit } from '../telemetry/index.ts';
import { clientNetwork, keyHash } from './client-key.ts';
import { LIMITS, type LimitName } from './definitions.ts';
import { securityEventLogger, type SecurityEventDetails } from './security-events.ts';
import type { CounterStore } from './store.ts';

export { counterStore, type CounterStore } from './store.ts';
export { loadLimitSettings, type LimitSettings } from './settings.ts';

export interface LimitOptions {
  readonly store: CounterStore;
  /** The key that hashes the counters' keys. */
  readonly key: Secret;
  /** The clock for remembered refusals, in milliseconds. For tests. */
  readonly now?: () => number;
}

/** How long /health waits for the counters before it answers without them. */
const HEALTH_WAIT_MS = 200;
/** Most keys counted in memory at once; past it a request is counted by the store alone. */
const MAX_KEYS = 10_000;
/** Store calls in progress at once for one key, so one client cannot fill the connection pool. */
const CALLS_PER_KEY = 2;

/** What this instance knows of one key in its current window. */
interface Local {
  /** The window's end in milliseconds: the store's once it has answered, else from the clock. */
  end: number;
  /** Requests seen in this window, including those whose store call failed. */
  count: number;
  /** Which window this is, so a late answer from an earlier one is not applied. */
  window: number;
  /** Store calls in progress, and the requests waiting for a turn. */
  active: number;
  readonly waiting: Array<() => void>;
}

type ReadSession = (request: FastifyRequest) => Promise<SessionRead>;

function audienceOf(request: FastifyRequest): unknown {
  const config = request.routeOptions.config as { contract?: { audience?: unknown } } | undefined;
  return config?.contract?.audience;
}

function addressLimit(request: FastifyRequest): LimitName {
  const url = request.routeOptions.url;
  if (url === '/health' || url === '/health/ready') return 'probe';
  if (url === '/openapi.json') return 'openapi';
  return audienceOf(request) === 'public' ? 'public' : 'general_ip';
}

/**
 * Adds the per-address hook to `server` and returns how to count signed-in
 * requests: it wraps readSession(), which the routes call once per request.
 */
export function registerLimits(server: FastifyInstance, options: LimitOptions) {
  const report = securityEventLogger();
  const now = options.now ?? Date.now;
  const keys = new Map<string, Local>();
  let sweepAt = 0;

  /**
   * This instance's count of a key in the current window. The shared count can
   * never be lower than the one instance's own, so past `max` it refuses from
   * memory, whether or not the store ever answered.
   */
  function local(id: string, windowMs: number): Local {
    const time = now();
    let entry = keys.get(id);
    if (entry === undefined) {
      if (keys.size >= MAX_KEYS && time >= sweepAt) {
        for (const [other, found] of keys) {
          if (found.end <= time && found.active === 0) keys.delete(other);
        }
        sweepAt = time + 1000;
      }
      entry = { end: 0, count: 0, window: 0, active: 0, waiting: [] };
      if (keys.size < MAX_KEYS) keys.set(id, entry);
    }
    if (entry.end <= time) {
      entry.end = (Math.floor(time / windowMs) + 1) * windowMs;
      entry.count = 0;
      entry.window++;
    }
    return entry;
  }

  /** One store call, after waiting for one of the key's turns. */
  async function call(entry: Local, limit: LimitName, key: Buffer) {
    const { bucket, windowSeconds } = LIMITS[limit];
    if (entry.active < CALLS_PER_KEY) entry.active++;
    else await new Promise<void>((resolve) => entry.waiting.push(resolve));
    try {
      return await options.store.count(bucket, key, windowSeconds);
    } finally {
      const next = entry.waiting.shift();
      if (next) next();
      else entry.active--;
    }
  }

  /** The counters' answer; /health gives up on them after HEALTH_WAIT_MS. */
  async function counted(request: FastifyRequest, entry: Local, limit: LimitName, key: Buffer) {
    const pending = call(entry, limit, key);
    if (request.routeOptions.url !== '/health') return pending;
    let timer: NodeJS.Timeout | undefined;
    const gaveUp = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('The counters did not answer in time.'));
      }, HEALTH_WAIT_MS);
    });
    try {
      return await Promise.race([pending, gaveUp]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function charge(request: FastifyRequest, limit: LimitName, subject: string) {
    const { max, metric } = LIMITS[limit];
    const key = keyHash(options.key, limit, subject);
    const audience = audienceOf(request);
    const app: SecurityEventDetails['app'] =
      audience === 'console' || audience === 'portal' ? audience : 'none';
    const event = { limit, app, client: clientNetwork(request.ip), key };
    const id = key.toString('hex');

    function refuse(retryAfter: number): never {
      report(request, { ...event, code: 'rate_limit_reached' });
      recordRateLimitHit({ limit: metric, app });
      throw new ApiError(429, undefined, {
        reason: 'rate_limited',
        headers: { 'retry-after': String(retryAfter) },
      });
    }

    const entry = local(id, LIMITS[limit].windowSeconds * 1000);
    entry.count++;
    const window = entry.window;
    if (entry.count > max) refuse(Math.max(1, Math.ceil((entry.end - now()) / 1000)));
    let result;
    try {
      result = await counted(request, entry, limit, key);
    } catch {
      report(request, { ...event, code: 'counter_store_unavailable' });
      if (request.routeOptions.url === '/health') return;
      throw new ApiError(503, undefined, { reason: 'limit_store_unavailable' });
    }
    // The store's window is the one that counts; the shared count may be ahead of ours.
    if (entry.window === window) {
      entry.end = now() + result.retryAfter * 1000;
      entry.count = Math.max(entry.count, result.count);
    }
    if (result.count > max) refuse(result.retryAfter);
  }

  server.addHook('onRequest', async (request) => {
    await charge(request, addressLimit(request), clientNetwork(request.ip));
  });

  return (read: ReadSession): ReadSession =>
    async (request) => {
      const found = await read(request);
      if (found.session !== null) {
        await charge(request, 'general_session', `${found.session.app}:${found.session.userId}`);
      }
      return found;
    };
}
