// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A savepoint in the caller's transaction, so one piece of work can be undone
// whole and its failure still recorded in the same commit (ADR 0027). Kysely's
// transaction has no savepoint of its own.

import { sql, type Transaction } from 'kysely';

/**
 * Run `work` and report whether it finished. If it throws, everything it
 * changed is rolled back and the error is dropped, since it could repeat a
 * value; the transaction stays usable. A broken connection still throws.
 */
export async function attempt(
  trx: Transaction<unknown>,
  work: () => Promise<void>,
): Promise<boolean> {
  await sql`SAVEPOINT attempt`.execute(trx);
  try {
    await work();
    return true;
  } catch {
    await sql`ROLLBACK TO SAVEPOINT attempt`.execute(trx);
    return false;
  }
}
