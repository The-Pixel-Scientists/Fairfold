// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of the submission pages, inside the funder's address. The
// list's filters and page travel in the search string, `search` below, and
// the detail page carries them back so "Submissions" returns to the same place.

export const SUBMISSIONS_PATH = '/submissions';

/** `search` is a string from searchOf(): empty, or starting with "?". */
export const submissionsPath = (search = '') => `${SUBMISSIONS_PATH}${search}`;

export const submissionPath = (submissionId: string, search = '') =>
  `${SUBMISSIONS_PATH}/${submissionId}${search}`;
