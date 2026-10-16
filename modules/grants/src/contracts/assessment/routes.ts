// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Staff assessment routes (ADR 0004), under `grants.reviews.assign`, for any
// round or submission in the tenant: the round's reviewer pool and who is
// assigned to review what. Each change records its own audit event:
// `grants.reviewer.added` or `.removed` per member, and
// `grants.assignment.created` or `.removed` per assignment. A conflicted
// assignment is the record of a declared conflict, so it is never removed.
// Automatic assignment is in automatic.ts, and the spread of scores in
// spread.ts.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import {
  assignedSchema,
  assignmentListSchema,
  reviewerCandidatesSchema,
  reviewerPoolSchema,
} from './answers.ts';
import { assignInputSchema, poolAddInputSchema } from './inputs.ts';

const assign = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.reviews.assign',
  scope: 'tenant',
} as const;

const round = { ...assign, params: z.strictObject({ roundId: idSchema }) } as const;

export const getReviewerPool = defineRoute({
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId/reviewers',
  summary: "List a round's reviewer pool with each reviewer's open assignments",
  responses: { 200: reviewerPoolSchema },
});

export const listReviewerCandidates = defineRoute({
  ...round,
  method: 'GET',
  path: '/console/rounds/:roundId/reviewer-candidates',
  summary: "List the members who can review and are not in a round's pool",
  responses: { 200: reviewerCandidatesSchema },
});

export const addReviewers = defineRoute({
  ...round,
  method: 'POST',
  path: '/console/rounds/:roundId/reviewers',
  summary: "Add up to 50 members who can review to a round's pool, all or none",
  body: poolAddInputSchema,
  responses: { 200: reviewerPoolSchema },
});

export const removeReviewer = defineRoute({
  ...assign,
  method: 'DELETE',
  path: '/console/rounds/:roundId/reviewers/:membershipId',
  summary: "Remove a reviewer with no assignments from a round's pool",
  params: z.strictObject({ roundId: idSchema, membershipId: idSchema }),
  responses: { 204: null },
});

export const listAssignments = defineRoute({
  ...assign,
  method: 'GET',
  path: '/console/submissions/:submissionId/assignments',
  summary: "List a submission's assignments, conflicted ones included",
  params: z.strictObject({ submissionId: idSchema }),
  responses: { 200: assignmentListSchema },
});

export const assignReviewers = defineRoute({
  ...assign,
  method: 'POST',
  path: '/console/stages/:stageId/assignments',
  summary:
    'Assign up to 5 reviewers from the pool to up to 200 submissions in a stage, all or none',
  params: z.strictObject({ stageId: idSchema }),
  body: assignInputSchema,
  responses: { 200: assignedSchema },
});

/** A conflicted assignment answers 409: it is the record of the conflict. */
export const removeAssignment = defineRoute({
  ...assign,
  method: 'DELETE',
  path: '/console/assignments/:assignmentId',
  summary: 'Remove an assignment that is neither scored nor conflicted',
  params: z.strictObject({ assignmentId: idSchema }),
  responses: { 204: null },
});

export const assessmentRoutes = {
  getReviewerPool,
  listReviewerCandidates,
  addReviewers,
  removeReviewer,
  listAssignments,
  assignReviewers,
  removeAssignment,
} as const;
