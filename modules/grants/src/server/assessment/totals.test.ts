// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { spreadOf, weightedTotal } from './totals.ts';

describe('weightedTotal', () => {
  it('is the sum of weight times score over the sum of weights, in hundredths', () => {
    // (2*4 + 1*5 + 1*2) / 4 = 3.75
    expect(
      weightedTotal([
        { weight: 2, score: 4 },
        { weight: 1, score: 5 },
        { weight: 1, score: 2 },
      ]),
    ).toBe(375);
  });

  it('rounds to two decimal places, halves upward', () => {
    expect(
      weightedTotal([
        { weight: 1, score: 1 },
        { weight: 1, score: 1 },
        { weight: 1, score: 2 },
      ]),
    ).toBe(133);
    expect(
      weightedTotal([
        { weight: 3, score: 4 },
        { weight: 5, score: 3 },
      ]),
    ).toBe(338);
  });

  it('is zero without weights', () => {
    expect(weightedTotal([])).toBe(0);
    expect(weightedTotal([{ weight: 0, score: 5 }])).toBe(0);
  });
});

describe('spreadOf', () => {
  it('gives the totals lowest first with their lowest, highest, range and mean', () => {
    expect(spreadOf([375, 200, 333])).toEqual({
      totals: [2, 3.33, 3.75],
      lowest: 2,
      highest: 3.75,
      range: 1.75,
      mean: 3.03,
    });
  });

  it('works from the rounded totals and needs no float subtraction', () => {
    expect(spreadOf([110, 140])).toMatchObject({ range: 0.3, mean: 1.25 });
  });

  it('is empty, with no figures, when no review is submitted', () => {
    expect(spreadOf([])).toEqual({
      totals: [],
      lowest: null,
      highest: null,
      range: null,
      mean: null,
    });
  });
});
