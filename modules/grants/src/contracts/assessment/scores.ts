// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A reviewer's scores against a stage's rubric: one per criterion, inside
// the criterion's scale, which the server checks. The comment is the
// reviewer's own words about the application.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { MAX_CRITERIA } from '../programme/inputs.ts';
import { programmeMessages, says } from '../programme/messages.ts';
import { paragraphs } from '../programme/text.ts';

/** A score as saved. `comment` is empty when there is none. */
export const scoreSchema = z.object({
  criterionId: idSchema,
  score: z.int(),
  comment: z.string(),
});

export type Score = z.infer<typeof scoreSchema>;

/** The lowest and highest any rubric's scale allows; each criterion has its own scale within them. */
const scoreValueSchema = z.int().min(0).max(10);

/**
 * The reviewer's scores as they stand, which replace those saved: a
 * criterion left out has no score. Each criterion once.
 */
export const scoresInputSchema = z.strictObject({
  scores: z
    .array(
      z.strictObject({
        criterionId: idSchema,
        score: scoreValueSchema,
        comment: paragraphs(2000).default(''),
      }),
    )
    .max(MAX_CRITERIA)
    .refine(
      (scores) => new Set(scores.map((score) => score.criterionId)).size === scores.length,
      says(programmeMessages.listedOnce),
    ),
});

export type ScoresInput = z.infer<typeof scoresInputSchema>;
