// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Spring 2027 applications behind the review previews, as they stand on
// 17 March 2027: 48 received, 41 eligible, 123 reviews assigned and 95
// submitted, and 11 shortlisted. They come from the story's applications, so
// every score and count is worked out from the reviews, not typed in.

import { applications } from '../story.ts';
import type { Application, ApplicationStatus } from '../story.ts';

export interface Row {
  reference: string;
  organisation: string;
  project: string;
  requested: number;
  submitted: string;
  status: ApplicationStatus;
  /** The result of the automatic checks, which a member of staff confirms. */
  eligibility: 'Passed' | 'Failed';
  /** Whether Ada Morgan, who is signed in as staff, is the case officer. */
  mine: boolean;
  /** The weighted total of each review submitted so far, out of 5. */
  totals: readonly number[];
  /** The mean of those totals, or null before any review. */
  score: number | null;
  reviews: { submitted: number; assigned: number };
}

const caseOfficer = new Set([
  'NF-CG-0412',
  'NF-CG-0402',
  'NF-CG-0398',
  'NF-CG-0377',
  'NF-CG-0389',
  'NF-CG-0369',
  'NF-CG-0415',
  'NF-CG-0422',
  'NF-CG-0434',
  'NF-CG-0405',
]);

export const round1 = (value: number): number => Math.round(value * 10) / 10;
export const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);
export const mean = (values: readonly number[]): number => sum(values) / values.length;

function row(application: Application): Row {
  const { reference, organisation, project, requested, submitted } = application;
  const totals = application.reviews
    .slice(0, application.inBy17March)
    .map((review) => review.total);
  return {
    reference,
    organisation,
    project,
    requested,
    submitted,
    status: application.statusOn17March,
    eligibility: application.ineligible === undefined ? 'Passed' : 'Failed',
    mine: caseOfficer.has(reference),
    totals,
    score: totals.length === 0 ? null : round1(mean(totals)),
    reviews: { submitted: totals.length, assigned: application.reviews.length },
  };
}

export const rows: readonly Row[] = applications.map(row);

export const statuses: readonly ApplicationStatus[] = ['In review', 'Shortlisted', 'Ineligible'];

export const submittedOn = (item: Pick<Row, 'submitted'>): number =>
  new Date(item.submitted).getTime();

/** The most useful next step for staff, from where the application stands. */
export function nextStep(item: Row): string {
  const waiting = item.reviews.assigned - item.reviews.submitted;
  switch (item.status) {
    case 'Ineligible':
      return 'No further action';
    case 'Shortlisted':
      return 'Ready for a decision';
    default:
      if (waiting > 0)
        return `Waiting for ${String(waiting)} ${waiting === 1 ? 'review' : 'reviews'}`;
      return range(item) >= WIDE_SPREAD ? 'Discuss the spread' : 'All reviews in';
  }
}

/** The highest weighted total minus the lowest, to one decimal place. */
export function range(item: Pick<Row, 'totals'>): number {
  return item.totals.length < 2 ? 0 : round1(Math.max(...item.totals) - Math.min(...item.totals));
}

/** A range at or above this is flagged as a wide spread. */
export const WIDE_SPREAD = 1.5;
