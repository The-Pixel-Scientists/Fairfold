// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Automatic assignment (ADR 0004), under `grants.reviews.assign`. For each
// chosen submission with fewer reviewers than asked for at the stage, the
// server adds pool members with the fewest open assignments in the round,
// never one already assigned to it at the stage or conflicted on it at any
// stage, ties broken by membership id so the result repeats. One
// transaction, and one `grants.assignment.created` per assignment.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { assignedSchema } from './answers.ts';
import { idList, MAX_ASSIGN_SUBMISSIONS, MAX_REVIEWERS_PER_SUBMISSION } from './inputs.ts';

/** Submissions in the stage, all submitted, and how many reviewers each should have there. */
export const automaticAssignInputSchema = z.strictObject({
  submissionIds: idList(MAX_ASSIGN_SUBMISSIONS),
  reviewersPerSubmission: z.int().min(1).max(MAX_REVIEWERS_PER_SUBMISSION),
});

export type AutomaticAssignInput = z.infer<typeof automaticAssignInputSchema>;

/** How many assignments were made, and each submission left short with how many reviewers it still needs. */
export const automaticAssignResultSchema = assignedSchema.extend({
  unfilled: z.array(z.object({ submissionId: idSchema, missing: z.int() })),
});

export type AutomaticAssignResult = z.infer<typeof automaticAssignResultSchema>;

export const assignReviewersAutomatically = defineRoute({
  audience: 'console',
  module: 'grants',
  permission: 'grants.reviews.assign',
  scope: 'tenant',
  method: 'POST',
  path: '/console/stages/:stageId/assignments/automatic',
  summary: 'Assign pool members to up to 200 submissions in a stage, balanced by open workload',
  params: z.strictObject({ stageId: idSchema }),
  body: automaticAssignInputSchema,
  responses: { 200: automaticAssignResultSchema },
});
