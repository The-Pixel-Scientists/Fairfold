// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Security events: structured lines in the log, not a table, written when a
// request is refused or the counters cannot be reached. A line holds the
// event code, the limit and its bucket, the app, the route template and the
// client network; the logger adds the time. Never the URL, a query, a body, a
// cookie, a token, a session, a slug or the user agent.
//
// The codes are a closed list:
//   rate_limit_reached         a request was refused with 429
//   counter_store_unavailable  the counters could not be reached
//
// Retention of the client network (an address, or the /64 of one): 12 months,
// as for the address on auth.audit_event (ADR 0010, ADR 0027). The log sink
// applies it (S11-65, S11-72), and the hardening guide states it (S12-37).
// Proposed; Aaron confirms.
//
// The line names the address `client`, since the redacting logger censors a
// key such as `ip`. Ordinary request lines still carry no address.

import type { FastifyRequest } from 'fastify';

import { LIMITS, type LimitName } from './definitions.ts';

export const SECURITY_EVENTS = ['rate_limit_reached', 'counter_store_unavailable'] as const;
export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

export interface SecurityEventDetails {
  readonly code: SecurityEvent;
  readonly limit: LimitName;
  readonly app: 'console' | 'portal' | 'none';
  /** The network from clientNetwork(). */
  readonly client: string;
  /** The counter's key hash, to log each event once per key and window. */
  readonly key: Buffer;
}

/** Most keys remembered at once; past it, further events are dropped until the next sweep. */
const MAX_REMEMBERED = 10_000;

/** Each event at most once per key and window, so a flood cannot flood the log. */
export function securityEventLogger(now: () => number = Date.now) {
  const loggedUntil = new Map<string, number>();
  let sweepAt = 0;
  return (request: FastifyRequest, details: SecurityEventDetails): void => {
    const time = now();
    if (time >= sweepAt) {
      for (const [id, until] of loggedUntil) if (until <= time) loggedUntil.delete(id);
      sweepAt = time + 60_000;
    }
    const id = `${details.code}:${details.key.toString('hex')}`;
    if (loggedUntil.has(id) || loggedUntil.size >= MAX_REMEMBERED) return;
    const { bucket, windowSeconds } = LIMITS[details.limit];
    const window = windowSeconds * 1000;
    loggedUntil.set(id, (Math.floor(time / window) + 1) * window);
    request.log.warn(
      {
        event: details.code,
        limit: details.limit,
        bucket,
        app: details.app,
        route: request.routeOptions.url ?? 'unmatched',
        client: details.client,
      },
      'Security event',
    );
  };
}
