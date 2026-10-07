// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How each reviewer scored each criterion, for the screens that show scores
// by reviewer. The weighted total is the sum of weight times score, over the
// total weight, so it is out of 5.

import { applications, criteria } from '../story.ts';
import { round1 } from './data.ts';
import type { Row } from './data.ts';

const weights = criteria.map((criterion) => criterion.weight);

export const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

/** The weighted total out of 5, for scores in the order of the rubric's criteria. */
export function weightedTotal(scores: readonly number[]): number {
  const points = scores.reduce((sum, score, index) => sum + score * (weights[index] ?? 0), 0);
  return round1(points / totalWeight);
}

/** Scores per criterion for the applications the previews open, by reviewer. */
const known: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>> = {
  'NF-CG-0412': {
    'Priya Shah': [5, 5, 5, 4, 4],
    'Hannah Lewis': [5, 4, 4, 4, 5],
    'Tom Okafor': [4, 4, 4, 4, 5],
  },
  'NF-CG-0402': {
    'Tom Okafor': [2, 2, 3, 1, 1],
    'Hannah Lewis': [3, 3, 3, 2, 2],
    'Priya Shah': [4, 4, 4, 5, 3],
  },
};

/**
 * Scores per criterion that add up to the total: a flat score, then the
 * heaviest criteria that fit the gap move by one each, starting from a
 * different criterion for each reviewer so the rows differ.
 */
export function breakdown(total: number, turn: number): number[] {
  const base = Math.min(5, Math.max(1, Math.round(total)));
  const scores = weights.map(() => base);
  let gap = Math.round(total * totalWeight) - base * totalWeight;
  const order = weights
    .map((weight, index) => ({ weight, index, rank: (index + turn) % weights.length }))
    .sort((a, b) => b.weight - a.weight || a.rank - b.rank);
  for (const { weight, index } of order) {
    if (gap === 0) break;
    if (Math.abs(gap) >= weight) {
      scores[index] = base + Math.sign(gap);
      gap -= Math.sign(gap) * weight;
    }
  }
  return scores;
}

export interface ReviewScores {
  reviewer: string;
  scores: readonly number[];
  total: number;
}

/** What each reviewer who has submitted scored, in the order they submitted. Their totals are the story's. */
export function reviewScores(item: Pick<Row, 'reference' | 'totals'>): readonly ReviewScores[] {
  const reviews =
    applications.find((application) => application.reference === item.reference)?.reviews ?? [];
  const turn = Number(item.reference.slice(-2));
  return reviews.slice(0, item.totals.length).map(({ reviewer, total }, index) => ({
    reviewer,
    scores: known[item.reference]?.[reviewer] ?? breakdown(total, turn + index),
    total,
  }));
}
