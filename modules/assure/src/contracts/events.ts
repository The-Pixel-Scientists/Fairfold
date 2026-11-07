// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure module's published events (ADR 0034). A possible match is
// raised for a person to review: the event carries ids only, never a name,
// identifier or listed entry, and is readable only with the screening read
// permission. `partyId` is the party screened and `listId` the list version.

import { idSchema } from '@pixel-scientists/domain';
import { defineEvent } from '@pixel-scientists/domain/events';
import { z } from 'zod';

export const screeningMatchFound = defineEvent('assure.screening_match_found.v1', {
  read: 'assure.screening.read',
  data: z.strictObject({
    matchId: idSchema,
    runId: idSchema,
    partyId: idSchema,
    listId: idSchema,
  }),
});
