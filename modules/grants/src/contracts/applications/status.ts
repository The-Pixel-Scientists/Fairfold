// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What an applicant is told about their application (ADR 0004, architecture
// rule 8). Until its decision is released, a submitted application is
// "Submitted" or "Under review", whatever its stage, scores or recorded
// decision; only release turns it into an outcome. Both functions here take
// the decision with its release state, so the rule is kept in one place.

import { moneySchema, type Money } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import type { Outcome } from '../programme/lists.ts';
import type { ApplicationStatus } from './lists.ts';

/** Each status, with the words the portal shows for it. */
export const applicantStatuses = {
  in_progress: 'In progress',
  submitted: 'Submitted',
  under_review: 'Under review',
  awarded: 'Awarded',
  waitlisted: 'On the waiting list',
  not_funded: 'Not funded',
  withdrawn: 'Withdrawn',
} as const;

export type ApplicantStatus = keyof typeof applicantStatuses;

export const applicantStatusSchema = z.enum(
  Object.keys(applicantStatuses) as [ApplicantStatus, ...ApplicantStatus[]],
);

/** An application's decision as recorded. `amount` is set for an award only. */
export interface ApplicantDecision {
  readonly outcome: Outcome;
  readonly amount: Money | null;
  readonly released: boolean;
}

export interface ApplicantStatusInput {
  readonly status: ApplicationStatus;
  /** Whether a submitted application is still in its round's first stage. */
  readonly inFirstStage: boolean;
  /** Released or not; null when none is recorded. */
  readonly decision: ApplicantDecision | null;
}

const released: Record<Outcome, ApplicantStatus> = {
  accepted: 'awarded',
  waitlisted: 'waitlisted',
  declined: 'not_funded',
};

export function applicantStatus({
  status,
  inFirstStage,
  decision,
}: ApplicantStatusInput): ApplicantStatus {
  if (status === 'draft') return 'in_progress';
  if (status === 'withdrawn') return 'withdrawn';
  if (decision?.released === true) return released[decision.outcome];
  return inFirstStage ? 'submitted' : 'under_review';
}

/** A released decision as the applicant sees it: the outcome and, for an award, the amount. */
export const applicantOutcomeSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('accepted'), amount: moneySchema }),
  z.object({ result: z.literal('waitlisted') }),
  z.object({ result: z.literal('declined') }),
]);

export type ApplicantOutcome = z.infer<typeof applicantOutcomeSchema>;

/** Null until the decision is released. */
export function applicantOutcome(decision: ApplicantDecision | null): ApplicantOutcome | null {
  if (decision?.released !== true) return null;
  if (decision.outcome !== 'accepted') return { result: decision.outcome };
  if (decision.amount === null) throw new Error('An award needs its amount.');
  return { result: 'accepted', amount: decision.amount };
}
