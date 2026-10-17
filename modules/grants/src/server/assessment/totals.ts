// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The arithmetic of the spread (ADR 0004), in whole hundredths so that no
// rounding error builds up: a review's weighted total is the sum of weight
// times score over the sum of the weights, rounded to two decimal places, and
// the figures worked out from the totals are rounded the same way.

const fromHundredths = (value: number) => value / 100;

/** A review's weighted total, in hundredths. A rubric whose weights sum to zero totals zero. */
export function weightedTotal(scores: readonly { weight: number; score: number }[]): number {
  const weights = scores.reduce((sum, { weight }) => sum + weight, 0);
  if (weights === 0) return 0;
  return Math.round(
    (100 * scores.reduce((sum, { weight, score }) => sum + weight * score, 0)) / weights,
  );
}

export interface Spread {
  readonly totals: number[];
  readonly lowest: number | null;
  readonly highest: number | null;
  readonly range: number | null;
  readonly mean: number | null;
}

/** The totals, in hundredths, lowest first, and the figures worked out from them. */
export function spreadOf(totals: readonly number[]): Spread {
  const sorted = [...totals].sort((a, b) => a - b);
  const lowest = sorted[0];
  const highest = sorted.at(-1);
  if (lowest === undefined || highest === undefined) {
    return { totals: [], lowest: null, highest: null, range: null, mean: null };
  }
  const mean = Math.round(sorted.reduce((sum, total) => sum + total, 0) / sorted.length);
  return {
    totals: sorted.map(fromHundredths),
    lowest: fromHundredths(lowest),
    highest: fromHundredths(highest),
    range: fromHundredths(highest - lowest),
    mean: fromHundredths(mean),
  };
}
