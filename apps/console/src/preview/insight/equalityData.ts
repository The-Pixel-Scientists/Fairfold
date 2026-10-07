// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Equality monitoring for Spring 2027. Every question lets people choose all
// that apply and "Prefer not to say", so a group's counts overlap and the
// percentages in a question do not add up to 100%. Counts under 5 are never
// shown (see format.ts), and a rate is shown only when both its counts are.

import { applications as received } from '../story.ts';
import { grants } from './grantsData.ts';

export const applications = received.length;
export const totalAwarded = grants.length;

export interface Group {
  id: string;
  label: string;
  applied: number;
  awarded: number;
}

export interface Question {
  id: string;
  title: string;
  prompt: string;
  groups: readonly Group[];
}

export const questions: readonly Question[] = [
  {
    id: 'leadership',
    title: 'Who leads the organisation',
    prompt: 'Who leads your organisation? Choose all that apply.',
    groups: [
      { id: 'women', label: 'Led by women', applied: 21, awarded: 7 },
      { id: 'disabled', label: 'Led by and for disabled people', applied: 10, awarded: 5 },
      {
        id: 'minoritised',
        label: 'Led by and for Black and minoritised communities',
        applied: 12,
        awarded: 5,
      },
      { id: 'lgbtq', label: 'Led by and for LGBTQ+ people', applied: 4, awarded: 1 },
      { id: 'none', label: 'None of these', applied: 13, awarded: 3 },
      { id: 'unsaid', label: 'Prefer not to say', applied: 5, awarded: 1 },
    ],
  },
  {
    id: 'benefit',
    title: 'Who benefits from the project',
    prompt: 'Who will benefit most from your project? Choose all that apply.',
    groups: [
      { id: 'low-income', label: 'People on low incomes', applied: 22, awarded: 8 },
      { id: 'young', label: 'Children and young people', applied: 17, awarded: 5 },
      { id: 'older', label: 'Older people', applied: 14, awarded: 5 },
      { id: 'disabled', label: 'Disabled people', applied: 11, awarded: 4 },
      { id: 'carers', label: 'Carers', applied: 6, awarded: 2 },
      { id: 'refugees', label: 'Refugees and migrants', applied: 4, awarded: 1 },
    ],
  },
];

/** A count is shown only from 5 up. */
export const shown = (value: number): boolean => value >= 5;

/** The share of all applications or all awards, or null while its count is hidden. */
export function share(value: number, whole: number): number | null {
  return shown(value) ? Math.round((value / whole) * 100) : null;
}

/** The share of a group's applications that were awarded, or null while either count is hidden. */
export function rate(group: Group): number | null {
  return shown(group.applied) && shown(group.awarded)
    ? Math.round((group.awarded / group.applied) * 100)
    : null;
}

/** How many counts the questions hide. */
export const hiddenCounts = questions
  .flatMap((question) => question.groups)
  .reduce((sum, group) => sum + Number(!shown(group.applied)) + Number(!shown(group.awarded)), 0);

export const overallRate = Math.round((totalAwarded / applications) * 100);
