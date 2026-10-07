// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Spring 2027 in numbers: one row per theme, so the dashboard's filter can
// recount every figure. The rows add up to the round's totals: 71 started,
// 48 submitted, 41 eligible, 41 reviewed, 22 shortlisted, 14 awarded, £612,400
// requested and £187,500 awarded. Everything is counted from the story's
// applications, except the drafts that were started and never sent.

import { candidates } from '../decide/decisions-data.ts';
import { springRound } from '../setup/data.ts';
import { applications, shortlistedByDecision } from '../story.ts';
import { amountOf, grantsIn } from './grantsData.ts';

export interface Theme {
  id: string;
  label: string;
  started: number;
  eligible: number;
  reviewed: number;
  shortlisted: number;
  /** Applications that were awarded a grant. */
  grants: number;
  requested: number;
  awarded: number;
  /** The day each application arrived, counted from opening day (2 February 2027) as day 0. */
  arrivals: readonly number[];
}

/** Each theme, with the drafts that were started in it and never sent. */
const themeList = [
  { id: 'older-people', label: 'Older people', drafts: 3 },
  { id: 'young-people', label: 'Young people', drafts: 5 },
  { id: 'food', label: 'Food', drafts: 3 },
  { id: 'arts', label: 'Arts', drafts: 4 },
  { id: 'health', label: 'Health', drafts: 4 },
  { id: 'places', label: 'Places', drafts: 4 },
] as const;

const opening = new Date(2027, 1, 2).getTime();
const arrivalDay = (submitted: string): number =>
  Math.round((new Date(submitted).getTime() - opening) / 86_400_000);

const shortlisted = new Set(
  candidates
    .filter((candidate) => candidate.rank <= shortlistedByDecision)
    .map((item) => item.reference),
);

export const themes: readonly Theme[] = themeList.map(({ id, label, drafts }) => {
  const submitted = applications.filter((application) => application.theme === label);
  const eligible = submitted.filter((application) => application.ineligible === undefined);
  const accepted = grantsIn('theme', label);
  return {
    id,
    label,
    started: submitted.length + drafts,
    eligible: eligible.length,
    reviewed: eligible.length,
    shortlisted: eligible.filter((application) => shortlisted.has(application.reference)).length,
    grants: accepted.length,
    requested: submitted.reduce((sum, application) => sum + application.requested, 0),
    awarded: amountOf(accepted),
    arrivals: submitted.map((application) => arrivalDay(application.submitted)),
  };
});

/** Days from closing on 3 March 2027 to release on 1 April 2027. */
export const daysToDecision = 29;

export const { budget } = springRound;

/** Opening day, 2 February 2027, to closing day, 3 March 2027: 30 days. */
export const roundDays = 30;

const day = (index: number) => new Date(Date.UTC(2027, 1, 2 + index));

/** A day of the round such as `3 March`, or `3 Mar` when short. */
export function dayLabel(index: number, month: 'long' | 'short' = 'long'): string {
  return day(index).toLocaleDateString('en-GB', { day: 'numeric', month, timeZone: 'UTC' });
}

export const submitted = (theme: Theme): number => theme.arrivals.length;

export interface RoundFigures {
  started: number;
  submitted: number;
  eligible: number;
  reviewed: number;
  shortlisted: number;
  grants: number;
  requested: number;
  awarded: number;
  perDay: readonly number[];
}

/** The figures for the themes chosen: all of them, or one. */
export function figuresFor(chosen: readonly Theme[]): RoundFigures {
  const total = (pick: (theme: Theme) => number) =>
    chosen.reduce((sum, theme) => sum + pick(theme), 0);
  return {
    started: total((theme) => theme.started),
    submitted: total(submitted),
    eligible: total((theme) => theme.eligible),
    reviewed: total((theme) => theme.reviewed),
    shortlisted: total((theme) => theme.shortlisted),
    grants: total((theme) => theme.grants),
    requested: total((theme) => theme.requested),
    awarded: total((theme) => theme.awarded),
    perDay: Array.from({ length: roundDays }, (_, index) =>
      total((theme) => theme.arrivals.filter((arrival) => arrival === index).length),
    ),
  };
}
