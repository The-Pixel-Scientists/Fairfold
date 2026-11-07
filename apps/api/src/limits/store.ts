// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The counters behind the limits, in app.request_limit (migration 0017), as
// app_api, shared by every API instance. They live outside any tenant
// transaction: no tenant is set, because the table holds none. The window
// starts on the database's clock, so instances with skewed clocks share it.

import type { Kysely } from '@pixel-scientists/db';
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

const EPOCH = '1970-01-01 00:00:00+00';

export function counterStore(db: Kysely<unknown>): CounterStore {
  const limits = db.$extendTables<{ 'app.request_limit': AppRequestLimit }>();
  return {
    async count(bucket, keyHash, windowSeconds) {
      const row = await limits
        .insertInto('app.request_limit')
        .values((eb) => ({
          bucket,
          key_hash: keyHash,
          window_start: eb.fn('date_bin', [
            // make_interval(years, months, weeks, days, hours, mins, secs)
            eb.fn(
              'make_interval',
              [0, 0, 0, 0, 0, 0, windowSeconds].map((part) => eb.val(part)),
            ),
            eb.fn('now'),
            eb.cast(eb.val(EPOCH), 'timestamptz'),
          ]),
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
      return { count: row.count, retryAfter: Math.max(1, Math.ceil(left / 1000)) };
    },
  };
}
