// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A decision as the dialogs build it: an outcome and, for an award, the
// amount as the field holds it. The server checks the same rules again; this
// says what is wrong before anything is sent.

import { formatMoney, moneySchema } from '@pixel-scientists/domain/platform';
import type { Money } from '@pixel-scientists/domain/platform';

import { outcomeIds } from '../../contracts/index.ts';
import type { Decision, DecisionInput, Outcome } from '../../contracts/index.ts';

export interface Draft {
  outcome: Outcome | '';
  /** What CurrencyInput holds: an amount in pence, the text typed when it is not one, or null. */
  amount: unknown;
}

export interface Problems {
  outcome?: string;
  amount?: string;
}

export interface AwardRange {
  awardMinimum: Money;
  awardMaximum: Money;
}

export const draftOf = (decision: Decision | null): Draft => ({
  outcome: decision?.outcome ?? '',
  amount: decision?.amount ?? null,
});

/** "Between £5,000 and £25,000, in pounds." */
export const rangeHint = ({ awardMinimum, awardMaximum }: AwardRange): string =>
  `Between ${formatMoney(awardMinimum)} and ${formatMoney(awardMaximum)}, in pounds.`;

/** The same words the server uses, so a refusal and a check read alike. */
const outOfRange = ({ awardMinimum, awardMaximum }: AwardRange) =>
  `Enter an amount between ${formatMoney(awardMinimum)} and ${formatMoney(awardMaximum)}.`;

/** The decision to send, or what is wrong with the draft. */
export function checkDraft(
  { outcome, amount }: Draft,
  range: AwardRange,
): { input: DecisionInput } | { problems: Problems } {
  if (outcome === '') return { problems: { outcome: 'Choose an outcome.' } };
  if (outcome !== 'accepted') return { input: { outcome } };
  if (amount === null || amount === '') {
    return { problems: { amount: 'Enter the amount to award, in pounds.' } };
  }
  const money = moneySchema.safeParse(amount);
  if (!money.success) {
    return { problems: { amount: 'Enter the amount in pounds, such as 12,500.' } };
  }
  const { amountMinor } = money.data;
  if (
    amountMinor < range.awardMinimum.amountMinor ||
    amountMinor > range.awardMaximum.amountMinor
  ) {
    return { problems: { amount: outOfRange(range) } };
  }
  return { input: { outcome, amount: money.data } };
}

export const isOutcome = (value: string): value is Outcome =>
  (outcomeIds as readonly string[]).includes(value);
