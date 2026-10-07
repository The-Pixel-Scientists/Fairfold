// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The 41 eligible Spring 2027 applications as the panel ranked them, and what
// it recorded on 26 March 2027: 14 accepted for £187,500, 6 waitlisted and 21
// declined. The requests of all 41 come to £574,900, and the 7 ineligible ones
// to £37,500, which is the £612,400 asked for in the round.

import { mean } from '../review/data.ts';
import { springRound } from '../setup/data.ts';
import { applications } from '../story.ts';
import type { Outcome } from '../story.ts';

export type { Outcome };

export const outcomes: readonly Outcome[] = ['Accept', 'Waitlist', 'Decline'];

/** The round's budget and the most and least the programme may award. */
export const { budget, minimumAward, maximumAward } = springRound;

export interface Candidate {
  reference: string;
  organisation: string;
  project: string;
  requested: number;
  /** The mean of the reviewers' weighted totals, out of 5. */
  score: number;
  outcome: Outcome;
  /** What would be awarded if accepted. It starts as the amount requested. */
  amount: number;
  rank: number;
}

const decided = applications.flatMap((application) => {
  const { reference, organisation, project, requested, decision } = application;
  return decision === undefined
    ? []
    : [
        {
          reference,
          organisation,
          project,
          requested,
          score: Math.round(mean(application.reviews.map((review) => review.total)) * 100) / 100,
          outcome: decision,
          amount: application.amount ?? requested,
        },
      ];
});

/** Ranked by mean score, highest first. */
export const candidates: readonly Candidate[] = decided
  .sort((a, b) => b.score - a.score)
  .map((item, index) => ({ ...item, rank: index + 1 }));

export function total(amounts: readonly number[]): number {
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

/** The accepted applications and what they come to. */
export const awards = candidates.filter((candidate) => candidate.outcome === 'Accept');
export const awardedTotal = total(awards.map((candidate) => candidate.amount));
