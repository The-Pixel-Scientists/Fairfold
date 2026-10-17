// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import type { Round } from '../../contracts/index.ts';
import { roundBody, roundDraft } from './roundDraft.ts';
import type { RoundDraft } from './roundDraft.ts';

const pounds = (amount: number) => ({ amountMinor: amount * 100, currency: 'GBP' }) as const;

const saved: Round = {
  id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  programmeId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  title: 'Spring 2027',
  opensAt: '2026-10-12T09:00',
  closesAt: '2026-11-02T17:00',
  timeZone: 'Europe/London',
  budget: pounds(150_000),
  awardMinimum: pounds(5_000),
  awardMaximum: pounds(25_000),
  latePolicy: 'accept_and_flag',
};

function problemsOf(draft: RoundDraft): { field: string; message: string }[] {
  try {
    roundBody(draft);
  } catch (error) {
    if (error instanceof ProblemError) return [...error.errors];
    throw error;
  }
  return [];
}

describe('roundDraft', () => {
  it('starts a new round empty, refusing late applications', () => {
    expect(roundDraft()).toEqual({
      title: '',
      opens: { date: null, time: '' },
      closes: { date: null, time: '' },
      budget: null,
      awardMinimum: null,
      awardMaximum: null,
      latePolicy: 'refuse',
    });
  });

  it('splits a saved round into the boxes the form has', () => {
    expect(roundDraft(saved)).toMatchObject({
      title: 'Spring 2027',
      opens: { date: '2026-10-12', time: '09:00' },
      closes: { date: '2026-11-02', time: '17:00' },
      budget: pounds(150_000),
      latePolicy: 'accept_and_flag',
    });
  });
});

describe('roundBody', () => {
  it('gives back the round that was saved, from its draft', () => {
    expect(roundBody(roundDraft(saved))).toEqual({
      title: 'Spring 2027',
      opensAt: '2026-10-12T09:00',
      closesAt: '2026-11-02T17:00',
      budget: pounds(150_000),
      awardMinimum: pounds(5_000),
      awardMaximum: pounds(25_000),
      latePolicy: 'accept_and_flag',
    });
  });

  it('says what to do about each box that is empty, beside that box, in the order of the form', () => {
    expect(problemsOf(roundDraft())).toEqual([
      { field: 'body.title', message: 'Enter a title for the round.' },
      {
        field: 'body.opensAt',
        message: 'Enter the opening date as a day, month and year, like 12 10 2026.',
      },
      { field: 'body.opensAtTime', message: 'Enter the opening time.' },
      {
        field: 'body.closesAt',
        message: 'Enter the closing date as a day, month and year, like 12 10 2026.',
      },
      { field: 'body.closesAtTime', message: 'Enter the closing time.' },
      { field: 'body.budget', message: 'Enter the budget in pounds, like £150,000.' },
      {
        field: 'body.awardMinimum',
        message: 'Enter the smallest award in pounds, like £5,000.',
      },
      { field: 'body.awardMaximum', message: 'Enter the largest award in pounds, like £25,000.' },
    ]);
  });

  it('refuses text that is not an amount, or a date that is only partly typed', () => {
    const problems = problemsOf({
      ...roundDraft(saved),
      opens: { date: '2026-10-', time: '09:00' },
      budget: 'lots',
    });

    expect(problems.map(({ field }) => field)).toEqual(['body.opensAt', 'body.budget']);
  });

  it('adds what the contract finds in boxes that are each fine on their own', () => {
    expect(
      problemsOf({ ...roundDraft(saved), closes: { date: '2026-10-01', time: '17:00' } }),
    ).toEqual([
      {
        field: 'body.closesAt',
        message: 'Enter a closing date and time after the opening date and time.',
      },
    ]);
    expect(problemsOf({ ...roundDraft(saved), awardMaximum: pounds(200_000) })).toEqual([
      {
        field: 'body.budget',
        message: 'Enter a budget the same as or more than the largest award.',
      },
    ]);
    expect(
      problemsOf({ ...roundDraft(saved), opens: { date: '2026-02-30', time: '09:00' } }),
    ).toEqual([{ field: 'body.opensAt', message: 'Enter a valid date.' }]);
  });
});
