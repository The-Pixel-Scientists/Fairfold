// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a round's decisions add up to, for the page's figures and the release
// summary. Going over the budget is shown, never refused (S08-04).

import { formatMoney } from '@pixel-scientists/domain/platform';

import type { DecisionList, DecisionRow, EmailDelivery, Outcome } from '../../contracts/index.ts';

export interface Tally extends Record<Outcome, number> {
  /** Submissions with no decision recorded. */
  undecided: number;
  /** Recorded decisions the applicant has not been told about. */
  unreleased: number;
  released: number;
}

export function tally(rows: readonly DecisionRow[]): Tally {
  const counts: Tally = {
    accepted: 0,
    waitlisted: 0,
    declined: 0,
    undecided: 0,
    unreleased: 0,
    released: 0,
  };
  for (const { decision } of rows) {
    if (decision === null) {
      counts.undecided += 1;
    } else {
      counts[decision.outcome] += 1;
      counts[decision.releasedAt === null ? 'unreleased' : 'released'] += 1;
    }
  }
  return counts;
}

/** How far over the budget the awards are, in pence; zero or less when they are within it. */
export const overBudget = ({ awarded, round }: DecisionList): number =>
  awarded.amountMinor - round.budget.amountMinor;

/** "£187,500 of £250,000, £62,500 left" or "£260,000 of £250,000, £10,000 over budget". */
export function budgetWords(list: DecisionList): string {
  const over = overBudget(list);
  const gap = formatMoney({ amountMinor: Math.abs(over), currency: list.round.budget.currency });
  const sums = `${formatMoney(list.awarded)} of ${formatMoney(list.round.budget)}`;
  return over > 0 ? `${sums}, ${gap} over budget` : `${sums}, ${gap} left`;
}

/** "1 decision", "5 decisions". */
export const countOf = (count: number, one: string, other = `${one}s`): string =>
  `${String(count)} ${count === 1 ? one : other}`;

/** What a send did: "5 emails sent. 2 waiting to send. 1 could not be sent." */
export function deliveryWords({ sent, failed, pending }: EmailDelivery): string {
  return [
    `${countOf(sent, 'email')} sent.`,
    `${String(pending)} waiting to send.`,
    ...(failed > 0 ? [`${String(failed)} could not be sent.`] : []),
  ].join(' ');
}
