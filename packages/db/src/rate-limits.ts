// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sign-in and email counters in auth.rate_limit (migration 0004, ADR 0010,
// "Sign-in limits and passwords"; no device cookies in MVP1), as app_auth,
// shared by every API instance. There is no lockout: a limit refuses
// attempts for a while, and a refused attempt does not count. Run these
// outside withTenant().
//
// An attempt is charged before its outcome is known, in one statement per
// counter that refuses while a delay runs, so attempts sent at once cannot
// pass a limit together. A sign-in counter at its limit sets a delay of 30
// seconds with each charge, doubling to at most 15 minutes, until 24 hours
// pass without a charge. An email counter at its limit waits for its hour
// to end.

import { isIP } from 'node:net';

import { sql, type Kysely, type Transaction } from 'kysely';

export type RateLimitScope =
  'sign_in_identifier_ip' | 'sign_in_identifier' | 'sign_in_ip' | 'email_identifier' | 'email_ip';

const RULES: Readonly<Record<RateLimitScope, { limit: number; window: string }>> = {
  sign_in_identifier_ip: { limit: 5, window: '15 minutes' },
  sign_in_identifier: { limit: 100, window: '1 hour' },
  sign_in_ip: { limit: 50, window: '15 minutes' },
  email_identifier: { limit: 3, window: '1 hour' },
  email_ip: { limit: 20, window: '1 hour' },
};

export const SIGN_IN_SCOPES = [
  'sign_in_identifier_ip',
  'sign_in_identifier',
  'sign_in_ip',
] as const;
export const EMAIL_SCOPES = ['email_identifier', 'email_ip'] as const;

/** Who an attempt counts against. */
export interface RateLimitClient {
  /** Normalised, or an HMAC (ADR 0010); never a password. */
  readonly identifier: string;
  /** An IPv4 or IPv6 address. IPv6 counts by its /64. */
  readonly ip: string;
}

/** The counter's key: the identifier, and the address as a /32 or /64 network, where the scope has them. */
function keyOf(scope: RateLimitScope, client: RateLimitClient) {
  const identifier = scope.includes('identifier') ? client.identifier : null;
  if (!scope.endsWith('_ip')) return { identifier, network: sql<null>`NULL::cidr` };
  if (isIP(client.ip) === 0) throw new Error('The client address is not an IP address.');
  const address = sql`${client.ip}::inet`;
  const network = sql<string>`network(set_masklen(${address},
    CASE WHEN family(${address}) = 4 THEN 32 ELSE 64 END))::cidr`;
  return { identifier, network };
}

const matching = (scope: RateLimitScope, client: RateLimitClient) => {
  const { identifier, network } = keyOf(scope, client);
  return sql`scope = ${scope} AND identifier IS NOT DISTINCT FROM ${identifier}
    AND client_ip IS NOT DISTINCT FROM ${network}`;
};

/** What a charge sets on a stored counter `r`, and on a new one. */
function charge(scope: RateLimitScope) {
  const { limit, window } = RULES[scope];
  const atLimit = (n: unknown) => sql`(${n})::int >= ${limit}::int`;
  const fresh = scope.startsWith('email_')
    ? sql`r.window_started_at <= now() - ${window}::interval`
    : sql`(r.count >= ${limit}::int AND r.updated_at <= now() - interval '24 hours')
        OR (r.count < ${limit}::int AND r.window_started_at <= now() - ${window}::interval)`;
  const count = sql`CASE WHEN ${fresh} THEN 1 ELSE r.count + 1 END`;
  const start = sql`CASE WHEN ${fresh} THEN now() ELSE r.window_started_at END`;
  // 30 seconds doubled 5 times passes 15 minutes, so the exponent stops there.
  const until = (n: unknown, from: unknown) =>
    scope.startsWith('email_')
      ? sql`${from} + ${window}::interval`
      : sql`now() + LEAST(30 * power(2, LEAST((${n})::int - ${limit}::int, 5)), 900) * interval '1 second'`;
  const blocked = (n: unknown, from: unknown) =>
    sql`CASE WHEN ${atLimit(n)} THEN ${until(n, from)} END`;
  return { count, start, blocked: blocked(count, start), first: blocked(sql`1`, sql`now()`) };
}

/** Refused with the seconds to wait, or counted, naming the scopes now at their limit. */
export type RateLimitCharge =
  | { readonly refused: true; readonly retryAfter: number }
  | { readonly refused: false; readonly reached: readonly RateLimitScope[] };

class Refused extends Error {}

/**
 * Charge one attempt to each scope, all or none, in a transaction of its
 * own. `onReached` runs in it when a scope reaches its limit, to record that.
 */
export async function chargeRateLimits<DB>(
  db: Kysely<DB>,
  scopes: readonly RateLimitScope[],
  client: RateLimitClient,
  onReached?: (trx: Transaction<DB>, reached: readonly RateLimitScope[]) => Promise<unknown>,
): Promise<RateLimitCharge> {
  try {
    const reached = await db.transaction().execute(async (trx) => {
      const found: RateLimitScope[] = [];
      for (const scope of scopes) {
        const { identifier, network } = keyOf(scope, client);
        const set = charge(scope);
        const { rows } = await sql<{ blocked: boolean }>`
          INSERT INTO auth.rate_limit AS r
            (scope, identifier, client_ip, count, window_started_at, blocked_until)
          VALUES (${scope}, ${identifier}, ${network}, 1, now(), ${set.first})
          ON CONFLICT (scope, identifier, client_ip) DO UPDATE
            SET count = ${set.count}, window_started_at = ${set.start}, blocked_until = ${set.blocked}
            WHERE r.blocked_until IS NULL OR r.blocked_until <= now()
          RETURNING blocked_until IS NOT NULL AS blocked
        `.execute(trx);
        const [row] = rows;
        if (row === undefined) throw new Refused();
        if (row.blocked) found.push(scope);
      }
      if (found.length > 0 && onReached !== undefined) await onReached(trx, found);
      return found;
    });
    return { refused: false, reached };
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
  }
  let retryAfter = 1;
  for (const scope of scopes) {
    const { rows } = await sql<{ seconds: number }>`
      SELECT ceil(extract(epoch FROM blocked_until - now()))::int AS seconds
        FROM auth.rate_limit WHERE ${matching(scope, client)} AND blocked_until > now()
    `.execute(db);
    retryAfter = Math.max(retryAfter, rows[0]?.seconds ?? 0);
  }
  return { refused: true, retryAfter };
}

/**
 * Give back a sign-in charge after a success, in `trx`: the identifier and
 * client counter starts afresh, and the others lose the attempt, and their
 * delay if that leaves them below their limit.
 */
export async function refundSignIn<DB>(
  trx: Transaction<DB>,
  client: RateLimitClient,
): Promise<void> {
  await sql`DELETE FROM auth.rate_limit WHERE ${matching('sign_in_identifier_ip', client)}`.execute(
    trx,
  );
  for (const scope of ['sign_in_identifier', 'sign_in_ip'] as const) {
    await sql`
      UPDATE auth.rate_limit SET count = count - 1, blocked_until =
             CASE WHEN count - 1 < ${RULES[scope].limit}::int THEN NULL ELSE blocked_until END
       WHERE ${matching(scope, client)} AND count > 0
    `.execute(trx);
  }
}
