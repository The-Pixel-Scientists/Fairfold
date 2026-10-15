// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The spread of scores (ADR 0004), under `grants.reviews.assign`, for staff
// only. Only submitted reviews count. A review's weighted total is the sum
// of each criterion's weight times its score over the sum of the weights,
// so it is on the rubric's scale; totals and the figures worked out from
// them are rounded to two decimal places.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import { z } from 'zod';

import { criterionSchema } from '../programme/answers.ts';
import { reviewerRefSchema } from './answers.ts';
import { scoreSchema } from './scores.ts';

const stageRefSchema = z.object({ id: idSchema, name: z.string() });

/**
 * A submission at one review stage. `assigned` counts its assignments there
 * that are not conflicted, `submitted` those submitted, and `totals` holds
 * their weighted totals, lowest first. The rest are null until one is.
 */
export const spreadRowSchema = z.object({
  submissionId: idSchema,
  organisation: z.object({ id: idSchema, name: z.string() }),
  stage: stageRefSchema,
  assigned: z.int(),
  submitted: z.int(),
  totals: z.array(z.number()),
  lowest: z.number().nullable(),
  highest: z.number().nullable(),
  range: z.number().nullable(),
  mean: z.number().nullable(),
});

export type SpreadRow = z.infer<typeof spreadRowSchema>;

/** Every submitted submission in a round with an assignment, one row per review stage. */
export const scoreSpreadSchema = z.object({ submissions: z.array(spreadRowSchema) });

export type ScoreSpread = z.infer<typeof scoreSpreadSchema>;

/** A submission's submitted reviews at each of its review stages, with the stage's criteria in order. */
export const submissionScoresSchema = z.object({
  stages: z.array(
    z.object({
      stage: stageRefSchema,
      criteria: z.array(criterionSchema),
      reviews: z.array(
        z.object({
          assignmentId: idSchema,
          reviewer: reviewerRefSchema,
          submittedAt: z.iso.datetime(),
          weightedTotal: z.number(),
          scores: z.array(scoreSchema),
        }),
      ),
    }),
  ),
});

export type SubmissionScores = z.infer<typeof submissionScoresSchema>;

const spread = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.reviews.assign',
  scope: 'tenant',
} as const;

export const getScoreSpread = defineRoute({
  ...spread,
  method: 'GET',
  path: '/console/rounds/:roundId/score-spread',
  summary: "Read the spread of each submission's weighted totals in a round",
  params: z.strictObject({ roundId: idSchema }),
  responses: { 200: scoreSpreadSchema },
});

export const getSubmissionScores = defineRoute({
  ...spread,
  method: 'GET',
  path: '/console/submissions/:submissionId/scores',
  summary: "Read a submission's submitted scores by reviewer and criterion",
  params: z.strictObject({ submissionId: idSchema }),
  responses: { 200: submissionScoresSchema },
});

export const spreadRoutes = { getScoreSpread, getSubmissionScores } as const;
