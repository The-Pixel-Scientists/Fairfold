// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the decision routes answer (ADR 0004, architecture rule 8). These
// are staff answers only: the applicant sees a decision through
// applicantOutcome(), and only once it is released.

import { idSchema } from '@pixel-scientists/domain';
import { moneySchema } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { outcomeSchema } from '../programme/lists.ts';
import { decisionEmailStatusSchema } from './lists.ts';

/** A recorded decision. `amount` is set exactly when accepted; `releasedAt` is null until released. */
export const decisionSchema = z.object({
  outcome: outcomeSchema,
  amount: moneySchema.nullable(),
  recordedAt: z.iso.datetime(),
  releasedAt: z.iso.datetime().nullable(),
});

export type Decision = z.infer<typeof decisionSchema>;

/**
 * A submission as the decisions page shows it. `meanScore` is the mean of
 * the weighted totals of its submitted reviews in the round, to two decimal
 * places, null when `reviews` is 0. `email` is null until the decision is
 * released.
 */
export const decisionRowSchema = z.object({
  submissionId: idSchema,
  organisation: z.object({ id: idSchema, name: z.string() }),
  stage: z.object({ id: idSchema, name: z.string() }),
  meanScore: z.number().nullable(),
  reviews: z.int(),
  decision: decisionSchema.nullable(),
  email: decisionEmailStatusSchema.nullable(),
});

export type DecisionRow = z.infer<typeof decisionRowSchema>;

/**
 * A round's submitted submissions, the highest mean score first, then
 * those with none. `awarded` adds up every accepted amount, released or
 * not, to compare with the budget; going over is shown, not refused.
 * `unsentEmails` counts the round's emails waiting to send or not sent.
 */
export const decisionListSchema = z.object({
  round: z.object({
    id: idSchema,
    title: z.string(),
    budget: moneySchema,
    awardMinimum: moneySchema,
    awardMaximum: moneySchema,
  }),
  submissions: z.array(decisionRowSchema),
  awarded: moneySchema,
  unsentEmails: z.int(),
});

export type DecisionList = z.infer<typeof decisionListSchema>;

/** How many decisions were recorded or changed. */
export const recordedSchema = z.object({ recorded: z.int() });

export type Recorded = z.infer<typeof recordedSchema>;

/** A decision's email as the applicant would get it, from the programme's latest template for its outcome. */
export const emailPreviewSchema = z.object({ subject: z.string(), body: z.string() });

export type EmailPreview = z.infer<typeof emailPreviewSchema>;

/**
 * What one request did with a round's emails: how many it sent, how many
 * failed, and how many it left waiting to send, past the 500 a request
 * sends (ADR 0020).
 */
export const emailDeliverySchema = z.object({
  sent: z.int(),
  failed: z.int(),
  pending: z.int(),
});

export type EmailDelivery = z.infer<typeof emailDeliverySchema>;

/** How many decisions were released, and what became of their emails. */
export const releaseResultSchema = emailDeliverySchema.extend({ released: z.int() });

export type ReleaseResult = z.infer<typeof releaseResultSchema>;
