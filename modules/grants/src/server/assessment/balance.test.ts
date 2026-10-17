// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { balance, type BalanceSubmission } from './balance.ts';

const submission = (
  id: string,
  filled = 0,
  excluded: readonly string[] = [],
): BalanceSubmission => ({ id, filled, excluded: new Set(excluded) });

const picksOf = (result: ReturnType<typeof balance>) =>
  result.picks.map((pick) => `${pick.submissionId}:${pick.membershipId}`);

describe('balance', () => {
  it('picks the reviewers with the fewest open assignments, ties by id', () => {
    const result = balance(
      [submission('s1')],
      ['a', 'b', 'c', 'd'],
      new Map([
        ['a', 3],
        ['b', 1],
        ['c', 1],
        ['d', 0],
      ]),
      2,
    );

    expect(picksOf(result)).toEqual(['s1:d', 's1:b']);
    expect(result.unfilled).toEqual([]);
  });

  it('counts each pick as open work for the next submission, so the load spreads', () => {
    const result = balance(
      [submission('s1'), submission('s2'), submission('s3')],
      ['a', 'b'],
      new Map(),
      1,
    );

    expect(picksOf(result)).toEqual(['s1:a', 's2:b', 's3:a']);
  });

  it('never picks an excluded reviewer and tops up a submission that has some', () => {
    const result = balance(
      [submission('s1', 1, ['a']), submission('s2', 2, [])],
      ['a', 'b', 'c'],
      new Map(),
      2,
    );

    expect(picksOf(result)).toEqual(['s1:b']);
    expect(result.unfilled).toEqual([]);
  });

  it('reports a submission the pool cannot fill, and how many it still needs', () => {
    const result = balance(
      [submission('s1', 0, ['a', 'b']), submission('s2')],
      ['a', 'b', 'c'],
      new Map(),
      2,
    );

    expect(picksOf(result)).toEqual(['s1:c', 's2:a', 's2:b']);
    expect(result.unfilled).toEqual([{ submissionId: 's1', missing: 1 }]);
    expect(balance([submission('s1')], [], new Map(), 2).unfilled).toEqual([
      { submissionId: 's1', missing: 2 },
    ]);
  });

  it('repeats: the same state gives the same picks whatever order the pool is listed in', () => {
    const state = new Map([['b', 1]]);
    const first = balance([submission('s1'), submission('s2')], ['c', 'b', 'a'], state, 2);
    const second = balance([submission('s1'), submission('s2')], ['a', 'b', 'c'], state, 2);

    expect(picksOf(first)).toEqual(picksOf(second));
  });
});
