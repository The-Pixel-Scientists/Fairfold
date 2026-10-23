// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { SpreadRow } from '../../contracts/index.ts';
import { barScale, figuresOf, gapOf } from './spread.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function row(n: number, totals: readonly number[], assigned = totals.length): SpreadRow {
  const lowest = totals.length === 0 ? null : Math.min(...totals);
  const highest = totals.length === 0 ? null : Math.max(...totals);
  return {
    submissionId: id(n),
    organisation: { id: id(100 + n), name: `Organisation ${String(n)}` },
    stage: { id: id(200), name: 'Review' },
    assigned,
    submitted: totals.length,
    totals: [...totals],
    lowest,
    highest,
    range: lowest === null || highest === null ? null : highest - lowest,
    mean: null,
  };
}

describe('the figures of a spread', () => {
  it('count the reviews, the submissions with two or more, the wide spreads and the middle range', () => {
    const figures = figuresOf([row(1, [3, 3.5], 3), row(2, [2, 4]), row(3, [4]), row(4, [], 2)]);

    expect(figures).toEqual({
      assigned: 8,
      submitted: 5,
      compared: 2,
      wide: 1,
      medianRange: 1.25,
    });
  });

  it('have no median until a submission has two reviews', () => {
    expect(figuresOf([row(1, [4])]).medianRange).toBeNull();
    expect(figuresOf([]).medianRange).toBeNull();
  });

  it('take the middle of an odd number of ranges', () => {
    expect(figuresOf([row(1, [1, 2]), row(2, [1, 4]), row(3, [1, 1.5])]).medianRange).toBe(1);
  });
});

describe('the scale of a range bar', () => {
  it('is five, or higher when a total is higher', () => {
    expect(barScale([row(1, [3, 4])])).toBe(5);
    expect(barScale([row(1, [3, 8.4])])).toBe(9);
    expect(barScale([])).toBe(5);
  });
});

describe('the gap between reviewers', () => {
  it('is the highest less the lowest, and none for fewer than two', () => {
    expect(gapOf([2, 5, 3])).toBe(3);
    expect(gapOf([4])).toBeNull();
    expect(gapOf([])).toBeNull();
  });
});
