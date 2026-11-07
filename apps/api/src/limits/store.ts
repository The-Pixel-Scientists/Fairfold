// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The counters behind the limits, in app.request_limit (migration 0017), as
// app_api, shared by every API instance. They live outside any tenant
// transaction: no tenant is set, because the table holds none. The window
// starts on the database's clock, so instances with skewed clocks share it.

import type { ExpressionBuilder, Kysely } from '@pixel-scientists/db';
import type { AppRequestLimit } from '@pixel-scientists/db/generated/app';

import type { Bucket } from './definitions.ts';

export interface Counted {
  /** Requests counted in this window, this one included. */
  readonly count: number;
  /** Whole seconds until the window ends. */
  readonly retryAfter: number;
}

export interface CounterStore {
  count(bucket: Bucket, keyHash: Buffer, windowSeconds: number): Promise<Counted>;
}

/** The upload buckets' counters (ADR 0030). */
export interface UploadCounters {
  /** Adds the amount only if the count then stays within max; a refusal changes nothing. */
  add(
    bucket: Bucket,
    keyHash: Buffer,
    windowSeconds: number,
    amount: number,
    max: number,
  ): Promise<{ readonly charged: true } | { readonly charged: false; readonly retryAfter: number }>;
  /** Takes the amount back from the count in the current window, never below zero. */
  subtract(bucket: Bucket, keyHash: Buffer, windowSeconds: number, amount: number): Promise<void>;
}

const EPOCH = '1970-01-01 00:00:00+00';

/** The start of the current window, on the database's clock. */
const windowStart = <DB, TB extends keyof DB>(
  eb: ExpressionBuilder<DB, TB>,
  windowSeconds: number,
) =>
  eb.fn<Date>('date_bin', [
    // make_interval(years, months, weeks, days, hours, mins, secs)
    eb.fn(
      'make_interval',
      [0, 0, 0, 0, 0, 0, windowSeconds].map((part) => eb.val(part)),
    ),
    eb.fn('now'),
    eb.cast(eb.val(EPOCH), 'timestamptz'),
  ]);

export function counterStore(db: Kysely<unknown>): CounterStore & UploadCounters {
  const limits = db.$extendTables<{ 'app.request_limit': AppRequestLimit }>();
  return {
    async count(bucket, keyHash, windowSeconds) {
      const row = await limits
        .insertInto('app.request_limit')
        .values((eb) => ({
          bucket,
          key_hash: keyHash,
          window_start: windowStart(eb, windowSeconds),
          count: 1,
        }))
        .onConflict((conflict) =>
          conflict
            .columns(['bucket', 'key_hash', 'window_start'])
            .doUpdateSet((eb) => ({ count: eb('app.request_limit.count', '+', 1) })),
        )
        .returning((eb) => ['count', 'window_start', eb.fn<Date>('now').as('now')])
        .executeTakeFirstOrThrow();
      const left = row.window_start.getTime() + windowSeconds * 1000 - row.now.getTime();
      return { count: Number(row.count), retryAfter: Math.max(1, Math.ceil(left / 1000)) };
    },

    async add(bucket, keyHash, windowSeconds, amount, max) {
      // The insert path takes no max, so an amount over it is refused up front.
      if (amount > max) return { charged: false, retryAfter: windowSeconds };
      const row = await limits
        .insertInto('app.request_limit')
        .values((eb) => ({
          bucket,
          key_hash: keyHash,
          window_start: windowStart(eb, windowSeconds),
          count: amount,
        }))
        .onConflict((conflict) =>
          conflict
            .columns(['bucket', 'key_hash', 'window_start'])
            .doUpdateSet((eb) => ({ count: eb('app.request_limit.count', '+', amount) }))
            .where((eb) => eb('app.request_limit.count', '<=', String(max - amount))),
        )
        .returning('count')
        .executeTakeFirst();
      if (row !== undefined) return { charged: true };
      const found = await limits
        .selectFrom('app.request_limit')
        .select((eb) => ['window_start', eb.fn<Date>('now').as('now')])
        .where('bucket', '=', bucket)
        .where('key_hash', '=', keyHash)
        .where((eb) => eb('window_start', '=', windowStart(eb, windowSeconds)))
        .executeTakeFirst();
      const left =
        found === undefined
          ? windowSeconds * 1000
          : found.window_start.getTime() + windowSeconds * 1000 - found.now.getTime();
      return { charged: false, retryAfter: Math.max(1, Math.ceil(left / 1000)) };
    },

    async subtract(bucket, keyHash, windowSeconds, amount) {
      await limits
        .updateTable('app.request_limit')
        .set((eb) => ({
          count: eb.fn('greatest', [eb(eb.ref('count'), '-', String(amount)), eb.val(0)]),
        }))
        .where('bucket', '=', bucket)
        .where('key_hash', '=', keyHash)
        .where((eb) => eb('window_start', '=', windowStart(eb, windowSeconds)))
        .execute();
    },
  };
}
