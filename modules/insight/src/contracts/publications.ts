// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publication runs (`insight.publication_run`): a 360Giving publication, a
// draft of the SORP grant-making note, or the annual return figures,
// prepared for a period for a named member to review and submit themselves.
// Nothing here submits anything to a regulator: marking a run submitted
// records that the acting member, from the session, says they did.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { insightMessages, says } from './messages.ts';

export const publicationKinds = ['three_sixty_giving', 'sorp_grant_note', 'annual_return'] as const;

export type PublicationKind = (typeof publicationKinds)[number];

/** `preparing` becomes `prepared` or `failed`; only `prepared` becomes `submitted`. */
export const publicationStates = ['preparing', 'prepared', 'failed', 'submitted'] as const;

export type PublicationState = (typeof publicationStates)[number];

export const publicationRunInputSchema = z
  .strictObject({
    kind: z.enum(publicationKinds),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
  })
  .refine(({ periodStart, periodEnd }) => periodStart < periodEnd, {
    ...says(insightMessages.periodOrder),
    path: ['periodEnd'],
  });

export type PublicationRunInput = z.infer<typeof publicationRunInputSchema>;

export const publicationRunSchema = z.object({
  id: idSchema,
  kind: z.enum(publicationKinds),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  state: z.enum(publicationStates),
  /** The prepared output, to review through the file download route. */
  outputFileId: idSchema.nullable(),
  /** Why preparing failed, as a code. */
  errorCode: z
    .string()
    .regex(/^[a-z_]+$/)
    .nullable(),
  preparedByMembershipId: idSchema,
  createdAt: z.iso.datetime(),
  submittedByMembershipId: idSchema.nullable(),
  submittedAt: z.iso.datetime().nullable(),
});

export type PublicationRun = z.infer<typeof publicationRunSchema>;

/** Newest first. */
export const publicationRunListSchema = z.object({ runs: z.array(publicationRunSchema) });

export type PublicationRunList = z.infer<typeof publicationRunListSchema>;
