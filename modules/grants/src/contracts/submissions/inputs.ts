// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the console's submission routes accept. Filters name only fields
// every member with `grants.applications.read` sees on every submission, and
// never an answer, so nobody can filter on what their projection hides
// (ADR 0004). Unknown keys, answer field ids among them, are refused.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { eligibilityOutcomeSchema, submissionStatusSchema } from '../applications/lists.ts';
import { programmeMessages, says } from '../programme/messages.ts';
import { submissionCursorSchema } from './answers.ts';

/** Every filter is optional, and these are the only keys. `eligibility` is the latest recorded check. */
export const submissionQuerySchema = z.strictObject({
  programmeId: idSchema.optional(),
  roundId: idSchema.optional(),
  stageId: idSchema.optional(),
  status: submissionStatusSchema.optional(),
  eligibility: eligibilityOutcomeSchema.optional(),
  late: z.stringbool().optional(),
  cursor: submissionCursorSchema.optional(),
});

export type SubmissionQuery = z.infer<typeof submissionQuerySchema>;

/** The most submissions one move takes. */
export const MAX_STAGE_MOVE = 200;

/**
 * Submissions to move into a stage of their own round, all or none: if any
 * is withdrawn, not found, or in another round, none moves.
 */
export const stageMoveInputSchema = z.strictObject({
  submissionIds: z
    .array(idSchema)
    .min(1)
    .max(MAX_STAGE_MOVE)
    .refine((ids) => new Set(ids).size === ids.length, says(programmeMessages.listedOnce)),
});

export type StageMoveInput = z.infer<typeof stageMoveInputSchema>;
