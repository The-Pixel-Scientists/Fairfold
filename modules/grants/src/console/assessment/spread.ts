// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Figures the spread page works out from the server's rows: only what the
// rows themselves cannot say. The server has already done the arithmetic of
// each submission.

import type { SpreadRow } from '../../contracts/index.ts';
import { isWide } from './words.ts';

export interface SpreadFigures {
  /** Reviews assigned, and how many of them are submitted. */
  assigned: number;
  submitted: number;
  /** Submissions with two or more submitted reviews, which have a spread to speak of. */
  compared: number;
  wide: number;
  /** The middle range among those, or null when none is compared. */
  medianRange: number | null;
}

export function figuresOf(rows: readonly SpreadRow[]): SpreadFigures {
  const compared = rows.filter((row) => row.submitted >= 2);
  const ranges = compared.map((row) => row.range ?? 0).sort((a, b) => a - b);
  const middle = Math.floor(ranges.length / 2);
  const median =
    ranges.length === 0
      ? null
      : ranges.length % 2 === 1
        ? (ranges[middle] ?? 0)
        : ((ranges[middle - 1] ?? 0) + (ranges[middle] ?? 0)) / 2;
  return {
    assigned: rows.reduce((sum, row) => sum + row.assigned, 0),
    submitted: rows.reduce((sum, row) => sum + row.submitted, 0),
    compared: compared.length,
    wide: rows.filter(isWide).length,
    medianRange: median,
  };
}

/** The scale a range bar is drawn on: from zero to the highest total, never less than five. */
export function barScale(rows: readonly SpreadRow[]): number {
  return Math.max(5, Math.ceil(Math.max(0, ...rows.map((row) => row.highest ?? 0))));
}

/** The gap between the highest and lowest of the numbers, or null for fewer than two. */
export function gapOf(values: readonly number[]): number | null {
  return values.length < 2 ? null : Math.max(...values) - Math.min(...values);
}
