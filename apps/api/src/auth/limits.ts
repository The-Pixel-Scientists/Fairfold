// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who sign-in and email limits count against (ADR 0010, "Sign-in limits and
// passwords"): the client address Fastify derived through the trusted
// proxies, never a header, and the typed identifier as ADR 0010 lets us
// keep it. The counters are in packages/db (rate-limits.ts).

import { createHmac, hkdfSync } from 'node:crypto';

import { emailSchema } from '@pixel-scientists/domain/auth';

import type { Secret } from '../config.ts';

/** An address as counted and recorded: IPv4-mapped IPv6 as IPv4, and no zone. */
export function plainAddress(ip: string): string {
  const address = ip.replace(/%.*$/, '');
  return /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] ?? address;
}

/**
 * A typed identifier as a counter or an event keeps it: normalised if it is
 * a valid address, otherwise an HMAC under its own purpose key, since it is
 * often a mistyped password.
 */
export function identifierKeeper(secret: Secret): (typed: string) => string {
  const key = Buffer.from(hkdfSync('sha256', secret.reveal(), '', 'tps-auth-identifier', 32));
  return (typed) => {
    const parsed = emailSchema.safeParse(typed);
    return parsed.success ? parsed.data : createHmac('sha256', key).update(typed).digest('hex');
  };
}
