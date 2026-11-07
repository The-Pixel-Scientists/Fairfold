// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Operator commands run as app_operator (ADR 0009; Aaron, 29 October 2026).
// app_worker is a member with SET but not INHERIT, so it holds the
// operator's rights only after SET LOCAL ROLE, which ends with the
// transaction. Run every operator write through these, inside a tenant's
// transaction from withTenant().

import { sql, type Kysely, type Transaction } from 'kysely';

import { withTenant, type TenantId } from './tenant-context.ts';

/** `work`, run as app_operator in the transaction it is given. */
export function asOperator<DB, T>(
  work: (trx: Transaction<DB>) => Promise<T>,
): (trx: Transaction<DB>) => Promise<T> {
  return async (trx) => {
    await sql`SET LOCAL ROLE app_operator`.execute(trx);
    return work(trx);
  };
}

/** Run `work` as app_operator in a transaction whose tenant is `tenant`. */
export function withOperator<DB, T>(
  db: Kysely<DB>,
  tenant: TenantId,
  work: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return withTenant(db, tenant, asOperator(work));
}
