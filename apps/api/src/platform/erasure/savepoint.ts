// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A savepoint in the job's transaction, so the erasure can be undone whole
// and the failure still recorded in the same commit (ADR 0027). Kysely's
// transaction has no savepoint and the API does not depend on Kysely, so the
// two fixed statements go through `executeQuery` as compiled queries.

import type { Transaction } from '@pixel-scientists/db';

const compiled = (sql: string) => ({
  sql,
  parameters: [],
  queryId: { queryId: 'erasure-savepoint' },
  query: { kind: 'RawNode' as const, sqlFragments: [sql], parameters: [] },
});

/**
 * Run `work` and report whether it finished. If it throws, everything it
 * changed is rolled back and the error is dropped, since it could repeat a
 * value; the transaction stays usable. A broken connection still throws.
 */
export async function attempt(trx: Transaction<unknown>, work: () => Promise<void>) {
  await trx.executeQuery(compiled('SAVEPOINT erasure'));
  try {
    await work();
    return true;
  } catch {
    await trx.executeQuery(compiled('ROLLBACK TO SAVEPOINT erasure'));
    return false;
  }
}
