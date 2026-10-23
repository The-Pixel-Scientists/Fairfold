// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkDraft, draftOf, rangeHint } from './draft.ts';

const gbp = (pounds: number) => ({ amountMinor: pounds * 100, currency: 'GBP' as const });
const range = { awardMinimum: gbp(5_000), awardMaximum: gbp(25_000) };

describe('draftOf', () => {
  it('starts empty, or from the decision recorded', () => {
    expect(draftOf(null)).toEqual({ outcome: '', amount: null });
    expect(
      draftOf({
        outcome: 'accepted',
        amount: gbp(12_500),
        recordedAt: '2026-11-20T10:00:00.000Z',
        releasedAt: null,
      }),
    ).toEqual({ outcome: 'accepted', amount: gbp(12_500) });
  });
});

describe('checkDraft', () => {
  it('asks for an outcome', () => {
    expect(checkDraft({ outcome: '', amount: null }, range)).toEqual({
      problems: { outcome: 'Choose an outcome.' },
    });
  });

  it('sends a waitlisting or a decline with no amount, even if one was typed before', () => {
    for (const outcome of ['waitlisted', 'declined'] as const) {
      expect(checkDraft({ outcome, amount: gbp(9_000) }, range)).toEqual({ input: { outcome } });
    }
  });

  it('sends an award within the range, ends included', () => {
    for (const pounds of [5_000, 12_500, 25_000]) {
      expect(checkDraft({ outcome: 'accepted', amount: gbp(pounds) }, range)).toEqual({
        input: { outcome: 'accepted', amount: gbp(pounds) },
      });
    }
  });

  it('says what is wrong with an amount, in the words the server uses', () => {
    const problem = (amount: unknown) => {
      const checked = checkDraft({ outcome: 'accepted', amount }, range);
      return 'problems' in checked ? checked.problems.amount : undefined;
    };
    expect(problem(null)).toBe('Enter the amount to award, in pounds.');
    expect(problem('')).toBe('Enter the amount to award, in pounds.');
    expect(problem('lots')).toBe('Enter the amount in pounds, such as 12,500.');
    expect(problem(gbp(4_999))).toBe('Enter an amount between £5,000 and £25,000.');
    expect(problem(gbp(25_001))).toBe('Enter an amount between £5,000 and £25,000.');
    expect(problem({ amountMinor: 1_000_000, currency: 'EUR' })).toBe(
      'Enter the amount in pounds, such as 12,500.',
    );
  });
});

describe('rangeHint', () => {
  it('shows the range in pounds', () => {
    expect(rangeHint(range)).toBe('Between £5,000 and £25,000, in pounds.');
  });
});
