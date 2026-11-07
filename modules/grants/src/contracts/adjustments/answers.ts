// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the console's adjustment routes answer (ADR 0004). These are staff
// answers only: the applicant sees no reason, kind or member, only the
// effective closing time on their application (applications/answers.ts).
// Times are local to the round's `timeZone`, as `2027-04-08T17:00`.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { memberRefSchema } from '../submissions/answers.ts';
import { adjustmentKindSchema, adjustmentReasonSchema, revokeReasonSchema } from './lists.ts';

/**
 * One adjustment for an organisation in a round, and for one of its
 * applications when `applicationId` is set, which only an extension may
 * be. `closesAt` is set exactly for a deadline extension. `revoked` is set
 * once, when it is removed.
 */
export const adjustmentSchema = z.object({
  id: idSchema,
  roundId: idSchema,
  organisation: z.object({ id: idSchema, name: z.string() }),
  applicationId: idSchema.nullable(),
  kind: adjustmentKindSchema,
  closesAt: z.string().nullable(),
  timeZone: z.string(),
  reasonCode: adjustmentReasonSchema,
  grantedBy: memberRefSchema,
  grantedAt: z.iso.datetime(),
  revoked: z
    .object({ by: memberRefSchema, at: z.iso.datetime(), reasonCode: revokeReasonSchema })
    .nullable(),
});

export type Adjustment = z.infer<typeof adjustmentSchema>;

/** A round's adjustments, the latest granted first. */
export const adjustmentListSchema = z.object({ adjustments: z.array(adjustmentSchema) });

export type AdjustmentList = z.infer<typeof adjustmentListSchema>;

/**
 * The adjustments that apply to one submission (those naming it and those
 * for its organisation in its round that name no application), and when it
 * closes by effectiveClosingTime(), local to `timeZone`.
 */
export const submissionAdjustmentsSchema = adjustmentListSchema.extend({
  closesAt: z.string(),
  timeZone: z.string(),
});

export type SubmissionAdjustments = z.infer<typeof submissionAdjustmentsSchema>;
