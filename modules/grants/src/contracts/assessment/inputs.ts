// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the staff assessment routes accept. Each change is all or none, and
// a list names each id once.

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { programmeMessages, says } from '../programme/messages.ts';

/** The most reviewers one request assigns, and automatic assignment gives a submission at a stage. */
export const MAX_REVIEWERS_PER_SUBMISSION = 5;

/** The most submissions one assignment request takes. */
export const MAX_ASSIGN_SUBMISSIONS = 200;

/** The most members added to a pool at once. */
export const MAX_POOL_ADD = 50;

/** 1 to `max` ids, each once. */
export function idList(max: number) {
  return z
    .array(idSchema)
    .min(1)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, says(programmeMessages.listedOnce));
}

/** Members to add to a round's pool. Each must hold `grants.reviews.score` and not be in it already. */
export const poolAddInputSchema = z.strictObject({ membershipIds: idList(MAX_POOL_ADD) });

export type PoolAddInput = z.infer<typeof poolAddInputSchema>;

/**
 * Assigns every reviewer listed to every submission listed, at a review
 * stage (one with a rubric). Every submission must be submitted and in the
 * stage, and every reviewer in the round's pool. No reviewer may be assigned
 * to a submission already at the stage, or conflicted on it at any stage.
 */
export const assignInputSchema = z.strictObject({
  submissionIds: idList(MAX_ASSIGN_SUBMISSIONS),
  membershipIds: idList(MAX_REVIEWERS_PER_SUBMISSION),
});

export type AssignInput = z.infer<typeof assignInputSchema>;
