// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reads of the outbox and cursors inside one tenant's transaction. Row-level
// security holds every query to that tenant; none names it.

import type { Transaction } from '@pixel-scientists/db';

import type { ConsumerCode } from './consumers.ts';

type Generated<T> = { __select__: T; __insert__: T | undefined; __update__: T };

type Tables = {
  'app.event_outbox': {
    tenant_id: string;
    id: string;
    sequence: string;
    type: string;
    payload: unknown;
    occurred_at: Date;
    request_id: string;
    caused_by: string | null;
    retain_until: Date;
  };
  'app.event_cursor': {
    tenant_id: string;
    id: Generated<string>;
    consumer: string;
    last_sequence: { __select__: string; __insert__: number; __update__: number };
    updated_at: Generated<Date>;
  };
  'app.event_sequence': { tenant_id: string; last_sequence: string };
};

export const tables = (trx: Transaction<unknown>) => trx.$extendTables<Tables>();

/** The oldest event number still within its retention, or null when none is. */
export async function oldestKept(trx: Transaction<unknown>): Promise<number | null> {
  const row = await tables(trx)
    .selectFrom('app.event_outbox')
    .select((eb) => eb.fn.min<string | null>('sequence').as('oldest'))
    .where('retain_until', '>', (eb) => eb.fn<Date>('now', []))
    .executeTakeFirstOrThrow();
  return row.oldest === null ? null : Number(row.oldest);
}

/**
 * Give `consumer` a cursor if it has none, just before the oldest event kept
 * (or at the tenant's last number when none is kept), so it starts there.
 */
export async function ensureCursor(trx: Transaction<unknown>, consumer: ConsumerCode) {
  const oldest = await oldestKept(trx);
  const last =
    oldest === null
      ? await tables(trx)
          .selectFrom('app.event_sequence')
          .select('last_sequence')
          .executeTakeFirst()
      : undefined;
  await tables(trx)
    .insertInto('app.event_cursor')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      consumer,
      last_sequence: oldest === null ? Number(last?.last_sequence ?? 0) : oldest - 1,
    }))
    .onConflict((conflict) => conflict.columns(['tenant_id', 'consumer']).doNothing())
    .execute();
}

/** The consumer's cursor, locked until the transaction ends so only one relay moves it. */
export async function lockCursor(trx: Transaction<unknown>, consumer: string) {
  const row = await tables(trx)
    .selectFrom('app.event_cursor')
    .select(['id', 'last_sequence'])
    .where('consumer', '=', consumer)
    .forUpdate()
    .executeTakeFirst();
  return row === undefined ? undefined : { id: row.id, last: Number(row.last_sequence) };
}

export async function moveCursor(
  trx: Transaction<unknown>,
  consumer: string,
  sequence: number,
): Promise<void> {
  await tables(trx)
    .updateTable('app.event_cursor')
    .set({ last_sequence: sequence })
    .where('consumer', '=', consumer)
    .execute();
}
