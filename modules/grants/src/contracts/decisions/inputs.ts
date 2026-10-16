// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the decision routes accept. An award's amount is more than nothing
// and no more than MAX_AMOUNT_MINOR here; the server also keeps it within
// the round's award range. Only a submitted application's unreleased
// decision is recorded or changed.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { idList } from '../assessment/inputs.ts';
import { amountSchema } from '../programme/inputs.ts';
import { programmeMessages, says } from '../programme/messages.ts';

/** The most decisions one request records or releases by choice. */
export const MAX_DECISIONS = 200;

/** An outcome, with the amount for an award and none otherwise. */
export const decisionInputSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('accepted'), amount: amountSchema }),
  z.strictObject({ outcome: z.literal('waitlisted') }),
  z.strictObject({ outcome: z.literal('declined') }),
]);

export type DecisionInput = z.infer<typeof decisionInputSchema>;

/** Decisions for up to 200 of a round's submissions, each once, all or none. */
export const bulkDecisionInputSchema = z.strictObject({
  decisions: z
    .array(z.strictObject({ submissionId: idSchema, decision: decisionInputSchema }))
    .min(1)
    .max(MAX_DECISIONS)
    .refine(
      (items) => new Set(items.map((item) => item.submissionId)).size === items.length,
      says(programmeMessages.listedOnce),
    ),
});

export type BulkDecisionInput = z.infer<typeof bulkDecisionInputSchema>;

/**
 * Which of a round's recorded, unreleased decisions to release: every one,
 * or those of the submissions listed, all or none. Saying `all` is
 * required, so a missing list never releases everything.
 */
export const releaseInputSchema = z.discriminatedUnion('release', [
  z.strictObject({ release: z.literal('all') }),
  z.strictObject({ release: z.literal('chosen'), submissionIds: idList(MAX_DECISIONS) }),
]);

export type ReleaseInput = z.infer<typeof releaseInputSchema>;
