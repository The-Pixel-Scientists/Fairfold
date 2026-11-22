// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The documents tables' contribution to erasure (ADR 0027, ADR 0040): the
// files of every signature request a subject signs, erased through
// app.erase_subject_documents(), the approved function, which refuses
// until the party is erased in this tenant. Every id, status, order and time
// stays, and the recorded hash of the file sent, so erasure changes no
// outcome. A repeat, such as after a restore, erases what came back. Board
// pack outputs expire with their job request and need nothing here.

import type { Transaction } from '@pixel-scientists/db';
import type { ErasureContribution } from '@pixel-scientists/domain/platform/subject-access';

export const documentsErasure: ErasureContribution<'platform', Transaction<unknown>> = {
  module: 'platform',
  async erase(tx, subjects) {
    let files = 0;
    for (const { partyId } of subjects) {
      const { counts } = await tx
        .selectNoFrom((eb) =>
          eb
            .fn<Record<string, number>>('app.erase_subject_documents', [eb.val(partyId)])
            .as('counts'),
        )
        .executeTakeFirstOrThrow();
      files += counts['app.file'] ?? 0;
    }
    return { 'app.file': files };
  },
};
