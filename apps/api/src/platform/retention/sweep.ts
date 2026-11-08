// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The retention sweep of one tenant (ADR 0003, ADR 0009), in that tenant's
// job transaction as app_worker. Tenant data is reached only through the
// database's approved functions: app.apply_retention() for each policy
// other than audit, then app.purge_expired_audit(). Neither takes a tenant,
// date or table; the database computes every cut-off, and each call that
// changes anything writes its own audit event. Calls are bounded by a
// budget, so no transaction runs until a backlog is empty.

import type { Transaction } from '@pixel-scientists/db';

import { AUDIT_POLICY, retentionPolicies } from './policies.ts';

/** app.purge_expired_audit() stops at this many rows a call (migration 0031); a call that returns it may have left more. */
export const AUDIT_PURGE_CAP = 10_000;

type Queryable = Pick<Transaction<unknown>, 'selectNoFrom' | 'selectFrom'>;

/** What one call of app.apply_retention() changed in one target table. */
export interface Applied {
  readonly policy: string;
  readonly table: string;
  readonly deleted: number;
  readonly anonymised: number;
}

export interface Swept {
  readonly applied: readonly Applied[];
  /** Expired audit events deleted. */
  readonly audit: number;
  /** Whether the budget ran out with work that may remain. */
  readonly remaining: boolean;
}

/** Calls the purge, up to `budget` times, while a call returns the cap. */
export async function purgeAudit(
  db: Queryable,
  budget: number,
): Promise<{ deleted: number; calls: number; remaining: boolean }> {
  let deleted = 0;
  let calls = 0;
  while (calls < budget) {
    calls++;
    const { count } = await db
      .selectNoFrom((eb) => eb.fn<number>('app.purge_expired_audit', []).as('count'))
      .executeTakeFirstOrThrow();
    deleted += count;
    if (count < AUDIT_PURGE_CAP) return { deleted, calls, remaining: false };
  }
  return { deleted, calls, remaining: true };
}

async function applyRetention(trx: Queryable, policy: string): Promise<Applied[]> {
  const rows = await trx
    .selectFrom((eb) =>
      eb
        .fn<{ target: string; deleted: number; anonymised: number }>('app.apply_retention', [
          eb.val(policy),
        ])
        .as('applied'),
    )
    .selectAll()
    .execute();
  return rows.map(({ target, deleted, anonymised }) => ({
    policy,
    table: target,
    deleted,
    anonymised,
  }));
}

/** Applies every policy and purges expired audit events, in at most `budget` calls. */
export async function sweepTenant(trx: Queryable, budget: number): Promise<Swept> {
  const applied: Applied[] = [];
  let calls = 0;
  for (const policy of retentionPolicies.keys()) {
    if (policy === AUDIT_POLICY) continue;
    for (;;) {
      if (calls >= budget) return { applied, audit: 0, remaining: true };
      calls++;
      const rows = await applyRetention(trx, policy);
      applied.push(...rows);
      if (rows.every((row) => row.deleted + row.anonymised === 0)) break;
    }
  }
  const purged = await purgeAudit(trx, budget - calls);
  return { applied, audit: purged.deleted, remaining: purged.remaining };
}
