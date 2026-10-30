// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The list's filters and page as the address holds them. The address is the
// source of truth, so Back, a bookmark and a shared link all show the same
// list. The contract's own query schema reads it, so a hand-edited address
// is refused the way the API would refuse it.

import { submissionQuerySchema } from '../../contracts/index.ts';
import type { SubmissionQuery } from '../../contracts/index.ts';

/** In the order they appear in the address. A page's `cursor` comes last. */
const FILTER_KEYS = ['programmeId', 'roundId', 'stageId', 'status', 'eligibility', 'late'] as const;

type FilterKey = (typeof FILTER_KEYS)[number];

/** A change to filters: a value sets one, undefined clears it. */
export type FilterChange = Partial<Record<FilterKey, string | undefined>>;

/** "?status=submitted", or an empty string when there is nothing to say. */
export function searchOf(query: SubmissionQuery): string {
  const params = new URLSearchParams();
  for (const key of [...FILTER_KEYS, 'cursor'] as const) {
    const value = query[key];
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * The query after a filter changes. Any change returns to the first page, and
 * a round belongs to one programme and a stage to one round, so changing a
 * programme clears both and changing a round clears the stage.
 */
export function withFilter(query: SubmissionQuery, change: FilterChange): SubmissionQuery {
  const cleared: FilterChange =
    'programmeId' in change
      ? { roundId: undefined, stageId: undefined }
      : 'roundId' in change
        ? { stageId: undefined }
        : {};
  const next: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = { ...query, ...cleared, ...change }[key];
    if (value !== undefined) next[key] = String(value);
  }
  return submissionQuerySchema.parse(next);
}

export function withCursor(query: SubmissionQuery, cursor: string | undefined): SubmissionQuery {
  const rest = { ...query };
  delete rest.cursor;
  return cursor === undefined ? rest : { ...rest, cursor };
}

/** True when any filter is set. A page of results is not a filter. */
export function isFiltered(query: SubmissionQuery): boolean {
  return FILTER_KEYS.some((key) => query[key] !== undefined);
}

/** What `call()` takes for the list route: the contract's input, where `late` is still text. */
export function callQuery(query: SubmissionQuery) {
  const { late, ...rest } = query;
  return late === undefined ? rest : { ...rest, late: String(late) };
}
