// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs every module's erasure contribution (ADR 0016, ADR 0027) in the
// caller's transaction, which carries the tenant, whether or not the tenant
// has the module switched on, since a module keeps its data when it is off.
// A contribution changes data only through its module's approved functions.
// Party runs first, because grants' and the file functions refuse until the
// party is erased; the rest follow in registration order. A contribution
// that throws, or answers anything but counts by table, fails the whole
// erasure and the caller rolls it back.

import type { Transaction } from '@pixel-scientists/db';
import type { ModuleId } from '@pixel-scientists/domain/platform';
import {
  erasureCountsSchema,
  type ErasureContribution,
  type ErasureCounts,
  type ErasureSubject,
} from '@pixel-scientists/domain/platform/subject-access';

export type Contribution = ErasureContribution<ModuleId, Transaction<unknown>>;

/** Rows changed in each table by all the contributions together. */
export async function runErasure(
  tx: Transaction<unknown>,
  contributions: readonly Contribution[],
  subjects: readonly ErasureSubject[],
): Promise<ErasureCounts> {
  const modules = contributions.map(({ module }) => module);
  if (new Set(modules).size !== modules.length) {
    throw new Error('A module has more than one erasure contribution.');
  }
  const ordered = [
    ...contributions.filter(({ module }) => module === 'party'),
    ...contributions.filter(({ module }) => module !== 'party'),
  ];
  const total: Record<string, number> = {};
  for (const { module, erase } of ordered) {
    const counts = erasureCountsSchema.safeParse(await erase(tx, subjects));
    // The error is not passed on: it could repeat a value.
    if (!counts.success) throw new Error(`The ${module} module's erasure result is not valid.`);
    for (const [table, count] of Object.entries(counts.data)) {
      total[table] = (total[table] ?? 0) + count;
    }
  }
  return total;
}
