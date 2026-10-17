// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A round as the form holds it, and the request it becomes. People type a
// date in three boxes, a time, and amounts in pounds; the contract takes
// `2027-02-02T09:00` and pence. Text that cannot become either is refused
// here, in words about the box it was typed in. The contract's own checks
// (a closing time after the opening time, an award range inside the budget)
// run when the request is made.

import type { FieldProblem, Money } from '@pixel-scientists/domain/platform';

import { roundInputSchema } from '../../contracts/index.ts';
import type { LatePolicy, Round } from '../../contracts/index.ts';
import { splitLocal } from './format.ts';
import { refuseUnless, topField } from './problems.ts';

/** A date as the date boxes give it, and a time as `09:00`. */
export interface Moment {
  date: string | null;
  time: string;
}

export interface RoundDraft {
  title: string;
  opens: Moment;
  closes: Moment;
  /** Each amount is what the amount box gave: an amount in pence, or what was typed. */
  budget: unknown;
  awardMinimum: unknown;
  awardMaximum: unknown;
  latePolicy: LatePolicy;
}

const emptyMoment: Moment = { date: null, time: '' };

function momentOf(local: string): Moment {
  const parts = splitLocal(local);
  return parts === null ? emptyMoment : parts;
}

export function roundDraft(round?: Round): RoundDraft {
  return {
    title: round?.title ?? '',
    opens: round === undefined ? emptyMoment : momentOf(round.opensAt),
    closes: round === undefined ? emptyMoment : momentOf(round.closesAt),
    budget: round?.budget ?? null,
    awardMinimum: round?.awardMinimum ?? null,
    awardMaximum: round?.awardMaximum ?? null,
    latePolicy: round?.latePolicy ?? 'refuse',
  };
}

function at(
  field: 'opensAt' | 'closesAt',
  word: 'opening' | 'closing',
  { date, time }: Moment,
  problems: FieldProblem[],
): string {
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    problems.push({
      field: `body.${field}`,
      message: `Enter the ${word} date as a day, month and year, like 12 10 2026.`,
    });
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    problems.push({ field: `body.${field}Time`, message: `Enter the ${word} time.` });
  }
  return `${date ?? ''}T${time}`;
}

function amount(
  field: 'budget' | 'awardMinimum' | 'awardMaximum',
  what: string,
  example: string,
  value: unknown,
  problems: FieldProblem[],
): Money {
  const pence = (value as { amountMinor?: unknown } | null)?.amountMinor;
  if (typeof pence === 'number') return { amountMinor: pence, currency: 'GBP' };
  problems.push({
    field: `body.${field}`,
    message: `Enter the ${what} in pounds, like ${example}.`,
  });
  return { amountMinor: 0, currency: 'GBP' };
}

/** The boxes in the order they appear, which is the order problems are listed in. */
const ORDER = [
  'title',
  'opensAt',
  'opensAtTime',
  'closesAt',
  'closesAtTime',
  'budget',
  'awardMinimum',
  'awardMaximum',
  'latePolicy',
];

/**
 * The request for a round, or a refusal naming everything wrong with it:
 * each box that cannot become part of one, and then what the contract's
 * checks find in the rest.
 */
export function roundBody(draft: RoundDraft) {
  const problems: FieldProblem[] = [];
  const body = {
    title: draft.title,
    opensAt: at('opensAt', 'opening', draft.opens, problems),
    closesAt: at('closesAt', 'closing', draft.closes, problems),
    budget: amount('budget', 'budget', '£150,000', draft.budget, problems),
    awardMinimum: amount('awardMinimum', 'smallest award', '£5,000', draft.awardMinimum, problems),
    awardMaximum: amount('awardMaximum', 'largest award', '£25,000', draft.awardMaximum, problems),
    latePolicy: draft.latePolicy,
  };
  // A time that cannot be read leaves its moment unchecked, as a date that cannot be read does.
  const covered = problems.map(({ field }) => field.replace(/Time$/, ''));
  refuseUnless(
    roundInputSchema,
    body,
    problems,
    (field) => ORDER.indexOf(topField(field)),
    covered,
  );
  return body;
}
