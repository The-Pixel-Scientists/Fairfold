// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How long a statement waits for a lock, for the rest of one transaction.

import { sql, type Transaction } from 'kysely';

/**
 * SET LOCAL lock_timeout for the rest of `trx`: '5s' fails a statement that
 * waits longer with SQLSTATE 55P03; 'default' restores the role or database
 * setting. SET takes no bound parameter, so each value is a fixed statement
 * and nothing is interpolated.
 */
export async function setLocalLockTimeout<DB>(
  trx: Transaction<DB>,
  timeout: '5s' | 'default',
): Promise<void> {
  if (timeout === '5s') {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(trx);
  } else {
    await sql`SET LOCAL lock_timeout TO DEFAULT`.execute(trx);
  }
}
