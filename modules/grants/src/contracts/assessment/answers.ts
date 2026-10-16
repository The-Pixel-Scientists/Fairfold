// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the staff assessment routes answer (ADR 0004). These are staff
// answers only, never reused for reviewers: reviewers have their own in
// reviews.ts. A reviewer is a member of the tenant, known by their
// membership id, and named from their person record.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { assignmentStatusSchema } from './lists.ts';

/** A member as the pool and assignments show them. `name` is null when their person record has none. */
export const reviewerRefSchema = z.object({ membershipId: idSchema, name: z.string().nullable() });

export type ReviewerRef = z.infer<typeof reviewerRefSchema>;

/**
 * A reviewer in a round's pool. `openAssignments` counts their assignments
 * in the round not yet submitted, which automatic assignment balances;
 * `assignments` counts every one, and a reviewer with any cannot be removed.
 */
export const poolReviewerSchema = reviewerRefSchema.extend({
  openAssignments: z.int(),
  assignments: z.int(),
});

/** A round's reviewer pool, by name. */
export const reviewerPoolSchema = z.object({ reviewers: z.array(poolReviewerSchema) });

export type ReviewerPool = z.infer<typeof reviewerPoolSchema>;

/** Active members who hold `grants.reviews.score` and are not in the round's pool, by name. */
export const reviewerCandidatesSchema = z.object({ members: z.array(reviewerRefSchema) });

export type ReviewerCandidates = z.infer<typeof reviewerCandidatesSchema>;

/**
 * A reviewer's assignment to a submission at one of its round's review
 * stages. `scored` is whether any score is saved: only an assignment with
 * none can be removed. `submittedAt` is set exactly when submitted.
 */
export const assignmentSchema = z.object({
  id: idSchema,
  submissionId: idSchema,
  stage: z.object({ id: idSchema, name: z.string() }),
  reviewer: reviewerRefSchema,
  status: assignmentStatusSchema,
  scored: z.boolean(),
  assignedAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable(),
});

export type Assignment = z.infer<typeof assignmentSchema>;

/** A submission's assignments, conflicted ones included, the earliest assigned first. */
export const assignmentListSchema = z.object({ assignments: z.array(assignmentSchema) });

export type AssignmentList = z.infer<typeof assignmentListSchema>;

/** How many assignments were made. */
export const assignedSchema = z.object({ assigned: z.int() });

export type Assigned = z.infer<typeof assignedSchema>;
