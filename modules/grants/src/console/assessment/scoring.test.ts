// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { Criterion } from '../../contracts/index.ts';
import {
  optionsOf,
  scaleOf,
  startingEntries,
  toInput,
  unscored,
  weightedTotal,
} from './scoring.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const criterion = (n: number, weight: number, scaleMin = 1, scaleMax = 5): Criterion => ({
  id: id(n),
  label: `Criterion ${String(n)}`,
  guidance: '',
  weight,
  scaleMin,
  scaleMax,
});

const criteria = [criterion(1, 5), criterion(2, 3), criterion(3, 2)];

describe('a reviewer’s entries', () => {
  it('start from the saved scores, with an empty entry for each criterion left', () => {
    const entries = startingEntries(criteria, [{ criterionId: id(2), score: 4, comment: 'Good' }]);

    expect(entries).toEqual({
      [id(1)]: { score: null, comment: '' },
      [id(2)]: { score: 4, comment: 'Good' },
      [id(3)]: { score: null, comment: '' },
    });
  });

  it('list the criteria with no score, in the rubric’s order', () => {
    const entries = startingEntries(criteria, [{ criterionId: id(2), score: 4, comment: '' }]);

    expect(unscored(criteria, entries).map(({ id: found }) => found)).toEqual([id(1), id(3)]);
  });

  it('are sent as the scored criteria only, in the rubric’s order, with comments trimmed', () => {
    const entries = {
      [id(1)]: { score: null, comment: 'Not scored, so not sent' },
      [id(2)]: { score: 0, comment: '  Zero is a score  ' },
      [id(3)]: { score: 5, comment: '' },
    };

    expect(toInput(criteria, entries)).toEqual({
      scores: [
        { criterionId: id(2), score: 0, comment: 'Zero is a score' },
        { criterionId: id(3), score: 5, comment: '' },
      ],
    });
  });
});

describe('the weighted total so far', () => {
  it('is the sum of weight times score over the weight of the scored criteria', () => {
    const entries = startingEntries(criteria, [
      { criterionId: id(1), score: 4, comment: '' },
      { criterionId: id(2), score: 3, comment: '' },
    ]);

    expect(weightedTotal(criteria, entries)).toBe(3.63);
  });

  it('is on the rubric’s scale when everything is scored, and none when nothing is', () => {
    const all = startingEntries(
      criteria,
      criteria.map(({ id: criterionId }) => ({ criterionId, score: 5, comment: '' })),
    );

    expect(weightedTotal(criteria, all)).toBe(5);
    expect(weightedTotal(criteria, startingEntries(criteria, []))).toBeNull();
  });

  it('counts a score of zero', () => {
    const entries = startingEntries(criteria, [
      { criterionId: id(1), score: 0, comment: '' },
      { criterionId: id(2), score: 4, comment: '' },
    ]);

    expect(weightedTotal(criteria, entries)).toBe(1.5);
  });
});

describe('a rubric’s scale', () => {
  it('runs from the lowest to the highest any criterion allows', () => {
    expect(scaleOf([criterion(1, 1, 1, 5), criterion(2, 1, 0, 10)])).toEqual({ min: 0, max: 10 });
  });

  it('gives a criterion its scores, lowest first', () => {
    expect(optionsOf(criterion(1, 1, 0, 3))).toEqual([0, 1, 2, 3]);
  });
});
