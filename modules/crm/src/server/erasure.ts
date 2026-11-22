// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm's contribution to erasure (ADR 0016, ADR 0027): the party's interaction
// summaries, import cells and external ids, anonymised in place through
// crm.erase_subject(), the approved function, which refuses until the party
// is erased in this transaction's tenant. A party this tenant does not have
// is skipped, so nothing of another tenant is touched. It keeps ids, codes
// and times, deletes nothing, and runs whether or not crm is switched on.

import type { ErasureContribution } from '@pixel-scientists/domain/platform/subject-access';
import { partyErasureTarget } from '@pixel-scientists/party/server';

import type { Tx } from './context.ts';

const TABLES = ['crm.interaction', 'crm.import_row', 'crm.external_reference'] as const;

export const crmErasure: ErasureContribution<'crm', Tx> = {
  module: 'crm',
  async erase(tx, subjects) {
    const total: Record<string, number> = Object.fromEntries(TABLES.map((table) => [table, 0]));
    for (const { partyId } of subjects) {
      if ((await partyErasureTarget(tx, partyId)) === null) continue;
      const { counts } = await tx
        .selectNoFrom((eb) =>
          eb.fn<Record<string, number>>('crm.erase_subject', [eb.val(partyId)]).as('counts'),
        )
        .executeTakeFirstOrThrow();
      for (const table of TABLES) total[table] = (total[table] ?? 0) + (counts[table] ?? 0);
    }
    return total;
  },
};
