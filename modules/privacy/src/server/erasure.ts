// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy module's contribution to erasure (ADR 0016, ADR 0027): the
// text a person or staff wrote about the erased party, through
// privacy.erase_subject(), the approved function. It clears each request's
// summary and each task's title and deletes nothing: the law requires the
// tenant to keep a record of the request, so the kind, dates, clock events
// and outcome stay. The function refuses until the party is erased, so this
// runs after the party module's contribution. It runs whether or not the
// tenant has the module switched on, and a repeat clears nothing further.

import type { ErasureContribution } from '@pixel-scientists/domain/platform/subject-access';

import type { Tx } from './context.ts';

export const privacyErasure: ErasureContribution<'privacy', Tx> = {
  module: 'privacy',
  async erase(tx, subjects) {
    const total: Record<string, number> = {
      'privacy.rights_request': 0,
      'privacy.request_task': 0,
    };
    for (const { partyId } of subjects) {
      const { counts } = await tx
        .selectNoFrom((eb) =>
          eb.fn<Record<string, number>>('privacy.erase_subject', [eb.val(partyId)]).as('counts'),
        )
        .executeTakeFirstOrThrow();
      for (const [table, count] of Object.entries(counts)) {
        total[table] = (total[table] ?? 0) + count;
      }
    }
    return total;
  },
};
