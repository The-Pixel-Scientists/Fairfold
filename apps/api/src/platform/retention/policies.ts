// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The retention policies the classification map names (rule 5): each
// `tenant_policy` rule's policy id, with the platform minimum no tenant can
// go below. The map is the one source; the database checks the same minimums.

import { classification } from '@pixel-scientists/db/classification';

function minimums(): ReadonlyMap<string, number> {
  const found = new Map<string, number>();
  for (const columns of Object.values(classification)) {
    for (const { retention } of Object.values(columns)) {
      if (retention.kind !== 'tenant_policy') continue;
      found.set(
        retention.policy,
        Math.max(found.get(retention.policy) ?? 0, retention.minimumDays),
      );
    }
  }
  return new Map([...found].sort(([a], [b]) => a.localeCompare(b)));
}

/** Policy id to platform minimum in days, in id order. */
export const retentionPolicies: ReadonlyMap<string, number> = minimums();

/** The audit policy is applied by app.purge_expired_audit(), every other by app.apply_retention(). */
export const AUDIT_POLICY = 'audit';
