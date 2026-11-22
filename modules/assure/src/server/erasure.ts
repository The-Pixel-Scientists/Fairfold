// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure module's contribution to erasure (ADR 0016, ADR 0027, ADR 0031).
// It anonymises each party of the merge set in place through
// assure.erase_subject(), the approved function, and changes nothing itself.
// The function refuses until the party is erased in this tenant, replaces
// names and free text, keeps ids, codes and decisions, and answers counts by
// table, never a value. Officer rows are matched through their link to the
// person, never by name, so a namesake is untouched. It runs whether or not
// the tenant has the module switched on.

import type {
  ErasureContribution,
  ErasureCounts,
} from '@pixel-scientists/domain/platform/subject-access';

import type { Tx } from './registries/store.ts';

export const assureErasure: ErasureContribution<'assure', Tx> = {
  module: 'assure',
  async erase(tx, subjects) {
    const total: Record<string, number> = {};
    for (const { partyId } of subjects) {
      const { counts } = await tx
        .selectNoFrom((eb) =>
          eb.fn<ErasureCounts>('assure.erase_subject', [eb.val(partyId)]).as('counts'),
        )
        .executeTakeFirstOrThrow();
      for (const [table, count] of Object.entries(counts)) {
        total[table] = (total[table] ?? 0) + count;
      }
    }
    return total;
  },
};
