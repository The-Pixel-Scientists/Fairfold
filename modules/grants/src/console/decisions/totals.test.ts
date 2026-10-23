// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { DecisionList, DecisionRow } from '../../contracts/index.ts';
import { budgetWords, countOf, deliveryWords, overBudget, tally } from './totals.ts';

const gbp = (pounds: number) => ({ amountMinor: pounds * 100, currency: 'GBP' as const });
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

const row = (decision: DecisionRow['decision']): DecisionRow => ({
  submissionId: ID,
  organisation: { id: ID, name: 'Northfield Community Trust' },
  stage: { id: ID, name: 'Decision' },
  meanScore: null,
  reviews: 0,
  decision,
  email: null,
});

const made = (outcome: 'accepted' | 'waitlisted' | 'declined', releasedAt: string | null) => ({
  outcome,
  amount: outcome === 'accepted' ? gbp(1_000) : null,
  recordedAt: '2026-11-20T10:00:00.000Z',
  releasedAt,
});

const list = (awarded: number): DecisionList => ({
  round: {
    id: ID,
    title: 'Autumn 2026',
    budget: gbp(150_000),
    awardMinimum: gbp(5_000),
    awardMaximum: gbp(25_000),
  },
  submissions: [],
  awarded: gbp(awarded),
  unsentEmails: 0,
});

describe('tally', () => {
  it('counts each outcome, the undecided, and what is private or released', () => {
    expect(
      tally([
        row(null),
        row(made('accepted', null)),
        row(made('accepted', '2026-11-25T09:00:00.000Z')),
        row(made('waitlisted', null)),
        row(made('declined', null)),
      ]),
    ).toEqual({
      accepted: 2,
      waitlisted: 1,
      declined: 1,
      undecided: 1,
      unreleased: 3,
      released: 1,
    });
  });
});

describe('the budget', () => {
  it('says what is left, or how far over, in words', () => {
    expect(budgetWords(list(12_500))).toBe('£12,500 of £150,000, £137,500 left');
    expect(budgetWords(list(150_000))).toBe('£150,000 of £150,000, £0 left');
    expect(budgetWords(list(160_000))).toBe('£160,000 of £150,000, £10,000 over budget');
    expect(overBudget(list(160_000))).toBe(1_000_000);
    expect(overBudget(list(100_000))).toBeLessThan(0);
  });
});

describe('words', () => {
  it('counts in the singular and the plural', () => {
    expect(countOf(1, 'decision')).toBe('1 decision');
    expect(countOf(2, 'decision')).toBe('2 decisions');
  });

  it('says what a send did, and mentions failures only when there are some', () => {
    expect(deliveryWords({ sent: 5, failed: 0, pending: 2 })).toBe(
      '5 emails sent. 2 waiting to send.',
    );
    expect(deliveryWords({ sent: 1, failed: 3, pending: 0 })).toBe(
      '1 email sent. 0 waiting to send. 3 could not be sent.',
    );
  });
});
