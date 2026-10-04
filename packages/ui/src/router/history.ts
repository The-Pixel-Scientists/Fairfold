// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The router numbers the history entries it creates, so that when someone
// goes back or forward and then declines to leave a page with unsaved
// changes, it knows how far to step to put them back.

const INDEX_KEY = 'tpsHistoryIndex';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The number stored on a history entry, or null for an entry the router did not create. */
export function readHistoryIndex(state: unknown): number | null {
  if (!isRecord(state)) return null;
  const index = state[INDEX_KEY];
  return typeof index === 'number' && Number.isInteger(index) ? index : null;
}

/** Keep whatever else is in the history state, and set the entry's number. */
export function withHistoryIndex(state: unknown, index: number): Record<string, unknown> {
  return { ...(isRecord(state) ? state : {}), [INDEX_KEY]: index };
}
