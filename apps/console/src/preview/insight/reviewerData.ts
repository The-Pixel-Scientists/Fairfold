// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reviewer calibration for Spring 2027, once all 123 reviews are in. Scores are
// weighted totals out of 5, using the rubric's weights. The means and ranges
// are worked out from the story's reviews, and the panel mean is the mean of
// all of them.

import { mean, round1 } from '../review/data.ts';
import { applications, reviewers } from '../story.ts';

export interface Calibration {
  name: string;
  assigned: number;
  submitted: number;
  mean: number;
  lowest: number;
  highest: number;
  medianMinutes: number;
}

const medianMinutes: Record<string, number> = {
  'Priya Shah': 38,
  'Tom Okafor': 36,
  'Hannah Lewis': 44,
  'Daniel Price': 29,
  'Grace Mbeki': 33,
  'Owen Hughes': 31,
};

const totalsBy = (name: string): number[] =>
  applications.flatMap((application) =>
    application.reviews.filter((review) => review.reviewer === name).map((review) => review.total),
  );

export const panelMean = round1(
  mean(applications.flatMap((application) => application.reviews.map((review) => review.total))),
);

export const calibration: readonly Calibration[] = reviewers.map(({ name, assigned }) => {
  const totals = totalsBy(name);
  return {
    name,
    assigned,
    submitted: assigned,
    mean: round1(mean(totals)),
    lowest: Math.min(...totals),
    highest: Math.max(...totals),
    medianMinutes: medianMinutes[name] ?? 0,
  };
});

/** The gap to the panel mean in tenths, as a signed number such as 0.2 or -0.6. */
export const gap = (reviewer: Calibration): number =>
  Math.round((reviewer.mean - panelMean) * 10) / 10;

const eligibleCount = applications.filter((application) => !application.ineligible).length;

/** How many applications had scores for one criterion 2 or more points apart, from most to least. */
const disagreementCounts = [
  { id: 'value', label: 'Value for money', count: 10 },
  { id: 'reach', label: 'Reach', count: 7 },
  { id: 'approach', label: 'Approach', count: 5 },
  { id: 'capacity', label: 'Capacity to deliver', count: 3 },
  { id: 'need', label: 'Need', count: 2 },
] as const;

export const disagreement = disagreementCounts.map((row) => ({
  ...row,
  share: Math.round((row.count / eligibleCount) * 100),
}));
