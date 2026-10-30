// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How assessment is put in words, so the pages and the tests say the same
// thing. Colour only ever backs the words up.

import type { TagTone } from '@pixel-scientists/ui';

import { assignmentStatuses } from '../../contracts/index.ts';
import type { AssignmentStatus, ReviewSummary } from '../../contracts/index.ts';

/** "1 reviewer", "3 reviewers". */
export function countOf(count: number, one: string, other = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : other}`;
}

/** The name of a member, or what to call one with no name on record. */
export const nameOf = (name: string | null): string => name ?? 'Unnamed member';

/**
 * A short form of an application's id, for reviewers: review is blind, so an
 * application is known by its id and its round and never by who applied.
 */
export const shortId = (id: string): string => id.replaceAll('-', '').slice(0, 8).toUpperCase();

export const applicationName = (id: string): string => `Application ${shortId(id)}`;

/** How an assignment looks to staff. */
export const assignmentTones: Readonly<Record<AssignmentStatus, TagTone>> = {
  assigned: 'info',
  submitted: 'success',
  conflicted: 'warning',
};

export const assignmentWords = (status: AssignmentStatus): string => assignmentStatuses[status];

/** Where a reviewer's own review stands. */
export type ReviewState = 'not started' | 'in progress' | 'submitted';

export function reviewStateOf({
  status,
  progress,
}: Pick<ReviewSummary, 'status' | 'progress'>): ReviewState {
  if (status === 'submitted') return 'submitted';
  return progress.scored === 0 ? 'not started' : 'in progress';
}

export const reviewStateWords: Readonly<Record<ReviewState, string>> = {
  'not started': 'Not started',
  'in progress': 'In progress',
  submitted: 'Submitted',
};

export const reviewStateTones: Readonly<Record<ReviewState, TagTone>> = {
  'not started': 'neutral',
  'in progress': 'info',
  submitted: 'success',
};

/** What a reviewer does next with a review. */
export const reviewActions: Readonly<Record<ReviewState, string>> = {
  'not started': 'Start review',
  'in progress': 'Continue',
  submitted: 'View review',
};

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** "21 January 2027", in the browser's time zone. */
export const formatDay = (iso: string): string => dayFormat.format(new Date(iso));

const scoreFormat = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

/** A score or a weighted total: "4.0", "3.67". */
export const formatScore = (value: number): string => scoreFormat.format(value);

/** A range of this much or more between reviewers is worth talking through before deciding. */
export const WIDE_SPREAD = 1.5;

/** Whether reviewers are far enough apart to flag. One review has no spread to speak of. */
export const isWide = (row: { submitted: number; range: number | null }): boolean =>
  row.submitted >= 2 && row.range !== null && row.range >= WIDE_SPREAD;
