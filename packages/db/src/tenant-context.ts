// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tenant context (ADR 0003, "Tenant context and queries"). Every tenant
// policy compares a row's tenant_id with app.current_tenant_id(), which reads
// the setting app.tenant_id. withTenant() is the one place that sets it, for
// one transaction at a time.

import { sql, type Kysely, type Transaction } from 'kysely';

import { internalsOf, kyselyOn } from './database.ts';

declare const trusted: unique symbol;

/**
 * A tenant id from a trusted source: the active tenant of a verified
 * session, the tenant of a job that the database checked when it was sent,
 * or an entry from the app.tenant_ids() fan-out. Never a bare uuid from a
 * request body, a URL or a caller's argument.
 */
export type TenantId = string & { readonly [trusted]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Mark a tenant id as coming from a trusted source. Only the code that reads
 * one of the sources above may call this, so the package's entry point does
 * not export it.
 */
export function trustedTenantId(value: string): TenantId {
  if (!UUID.test(value)) {
    throw new Error('A tenant id must be a uuid in lower case.');
  }
  return value as TenantId;
}

/**
 * withTenant() found a tenant already set on a pooled connection: something
 * set it for the whole session outside withTenant(). withTenant() reports it
 * through the client's `log` as a security event before throwing it.
 */
export class TenantLeakError extends Error {
  override name = 'TenantLeakError';

  constructor() {
    super('The database connection already has a tenant set. Refusing to use it.');
  }
}

/**
 * Run `work` in a transaction whose tenant is `tenant`, and return its
 * result. The transaction commits if `work` resolves and rolls back if it
 * throws.
 *
 * - The setting is transaction-local (`set_config(..., true)`), so it ends
 *   with the transaction.
 * - If the connection already has a tenant, it logs and throws
 *   TenantLeakError, and runs nothing.
 * - Afterwards it runs DISCARD ALL, which clears every setting, cursor
 *   (WITH HOLD ones outlive a transaction), LISTEN, session advisory lock,
 *   prepared statement and temporary table. Only then does the connection
 *   go back to the pool. If that fails, the connection is closed instead,
 *   and the transaction's outcome stands: the result of `work`, or the
 *   error the transaction ended with. That is the error from `work`, unless
 *   COMMIT or ROLLBACK failed too, in which case it is that failure. The
 *   reset error is added as its `cause` where it has none and can take one.
 *
 * `db` must come from createDatabase(), so a transaction cannot nest. Inside
 * `work`, run every query through `trx`. A query through `db` would run on
 * another connection, outside this transaction and with no tenant.
 */
export async function withTenant<DB, T>(
  db: Kysely<DB>,
  tenant: TenantId,
  work: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  const { pool, log } = internalsOf(db);
  const client = await pool.connect();

  let outcome: { failed: false; value: T } | { failed: true; error: unknown };
  try {
    const value = await kyselyOn<DB>(client)
      .transaction()
      .execute(async (trx) => {
        const { rows } = await sql<{ tenant: string | null }>`
          SELECT pg_catalog.current_setting('app.tenant_id', true) AS tenant
        `.execute(trx);
        if (rows[0]?.tenant) {
          const leak = new TenantLeakError();
          log('A tenant was already set on a pooled database connection.', leak);
          throw leak;
        }
        await sql`SELECT pg_catalog.set_config('app.tenant_id', ${tenant}, true)`.execute(trx);
        return await work(trx);
      });
    outcome = { failed: false, value };
  } catch (error) {
    outcome = { failed: true, error };
  }

  let resetFailed = false;
  try {
    await client.query('DISCARD ALL');
  } catch (resetError) {
    resetFailed = true;
    const reported = resetError instanceof Error ? resetError : new Error('DISCARD ALL failed.');
    log(
      'A database connection could not be reset after a transaction, so it was closed.',
      reported,
    );
    if (outcome.failed) addCause(outcome.error, reported);
  } finally {
    // true closes the connection: one that could not be reset is never reused.
    client.release(resetFailed);
  }

  if (outcome.failed) throw outcome.error;
  return outcome.value;
}

/** Add `cause` to `error` if it has none. A frozen error is left as it is. */
function addCause(error: unknown, cause: Error): void {
  try {
    if (error instanceof Error && error.cause === undefined) error.cause = cause;
  } catch {
    // The error is frozen or otherwise refuses the property.
  }
}
