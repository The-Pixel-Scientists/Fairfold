// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The reviewer's routes (ADR 0004), under `grants.reviews.score`. Reviews
// are reached through `assigned_review`: an assignment to the caller that
// is not conflicted. Anything else answers 404, as if it did not exist.
//
// Review is blind in MVP1. These answers are the reviewer's own, built here
// and never from a staff schema: no organisation, person, contact, other
// reviewer or decision appears in them. The application is known by its id
// and the round. Answers are projected for `blind_reviewer`, and the form
// definition sent with them holds only the fields that projection keeps.
//
// - Each read of a review records `grants.application.viewed`.
// - Declaring a conflict ends the assignment for good, recording
//   `grants.assignment.conflict_declared`; from then on every route here
//   answers 404 for it.
// - Saving scores is not audited, being the reviewer's unsubmitted work.
//   Submitting needs a score for every criterion, fixes the scores, and
//   records `grants.review.submitted`. A submitted review cannot change.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute, projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import { formDefinitionSchema } from '@pixel-scientists/domain/forms';
import { z } from 'zod';

import { criterionSchema } from '../programme/answers.ts';
import { reviewStatusSchema } from './lists.ts';
import { scoreSchema, scoresInputSchema } from './scores.ts';

/** One of the caller's assignments. `progress` counts the criteria scored out of the rubric's. */
export const reviewSummarySchema = z.object({
  id: idSchema,
  applicationId: idSchema,
  programme: z.object({ id: idSchema, title: z.string() }),
  round: z.object({ id: idSchema, title: z.string() }),
  stage: z.object({ id: idSchema, name: z.string() }),
  status: reviewStatusSchema,
  progress: z.object({ scored: z.int(), total: z.int() }),
  assignedAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable(),
});

export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

/** The caller's open and submitted assignments, the earliest assigned first. */
export const reviewListSchema = z.object({ reviews: z.array(reviewSummarySchema) });

export type ReviewList = z.infer<typeof reviewListSchema>;

/** One assignment: the blind answers and the form they answer, the stage's criteria in order, and the caller's scores. */
export const reviewSchema = reviewSummarySchema.extend({
  form: z.object({ definition: formDefinitionSchema }),
  answers: projectedAnswersSchemas.blind_reviewer,
  criteria: z.array(criterionSchema),
  scores: z.array(scoreSchema),
});

export type Review = z.infer<typeof reviewSchema>;

/** The caller's saved scores, in the order of the criteria. */
export const reviewScoresSchema = z.object({ scores: z.array(scoreSchema) });

export type ReviewScores = z.infer<typeof reviewScoresSchema>;

const score = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.reviews.score',
  scope: 'assigned_review',
} as const;

const review = { ...score, params: z.strictObject({ assignmentId: idSchema }) } as const;

export const listReviews = defineRoute({
  ...score,
  method: 'GET',
  path: '/console/reviews',
  summary: "List the caller's open and submitted reviews",
  responses: { 200: reviewListSchema },
});

export const getReview = defineRoute({
  ...review,
  method: 'GET',
  path: '/console/reviews/:assignmentId',
  summary: "Read one of the caller's reviews, with blind answers, the rubric and their scores",
  responses: { 200: reviewSchema },
});

export const declareConflict = defineRoute({
  ...review,
  method: 'POST',
  path: '/console/reviews/:assignmentId/conflict',
  summary: 'Declare a conflict of interest, which ends the assignment',
  responses: { 204: null },
});

export const saveReviewScores = defineRoute({
  ...review,
  method: 'PUT',
  path: '/console/reviews/:assignmentId/scores',
  summary: "Save a review's scores as a draft",
  body: scoresInputSchema,
  responses: { 200: reviewScoresSchema },
});

export const submitReview = defineRoute({
  ...review,
  method: 'POST',
  path: '/console/reviews/:assignmentId/submit',
  summary: 'Submit a review with a score for every criterion',
  body: scoresInputSchema,
  responses: { 200: reviewSummarySchema },
});

export const reviewRoutes = {
  listReviews,
  getReview,
  declareConflict,
  saveReviewScores,
  submitReview,
} as const;
