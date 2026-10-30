// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of the assessment pages, inside the funder's address. A
// reviewer's pages are under /reviews and a manager's belong to a round.

export const REVIEWS_PATH = '/reviews';

export const reviewPath = (assignmentId: string) => `${REVIEWS_PATH}/${assignmentId}`;

/** Where My reviews says a conflict was declared. */
export const CONFLICT_DECLARED_PATH = `${REVIEWS_PATH}?conflict=declared`;

export const reviewersPath = (roundId: string) => `/rounds/${roundId}/reviewers`;

export const spreadPath = (roundId: string) => `/rounds/${roundId}/score-spread`;
