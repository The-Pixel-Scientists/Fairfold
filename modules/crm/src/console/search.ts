// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The search form's choices as the request the API takes, and what the list
// keeps in memory so that going back from a record shows it as it was. The
// term is personal data: it lives here and in the page's state, never in an
// address, history entry, storage or title.

import { partyStatuses } from '../contracts/index.ts';
import type { PartySearchPage, PartySearchRequest } from '../contracts/index.ts';

export interface Filters {
  term: string;
  kind: 'any' | 'organisation' | 'person';
  /** `active` is what the API answers when no status is sent. */
  status: 'active' | 'any' | (typeof partyStatuses)[number];
  verification: 'any' | 'verified' | 'claimed' | 'none';
}

export const noFilters: Filters = { term: '', kind: 'any', status: 'active', verification: 'any' };

export function buildRequest(filters: Filters, cursor?: string): PartySearchRequest {
  return {
    term: filters.term,
    ...(filters.kind === 'any' ? {} : { kinds: [filters.kind] }),
    ...(filters.status === 'active'
      ? {}
      : { statuses: filters.status === 'any' ? [...partyStatuses] : [filters.status] }),
    ...(filters.verification === 'any' ? {} : { verification: filters.verification }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export interface Remembered {
  filters: Filters;
  results: PartySearchPage['results'];
  nextCursor: string | null;
  scrollY: number;
}

let remembered: Remembered | null = null;

export const recall = (): Remembered | null => remembered;
export const remember = (next: Remembered): void => {
  remembered = next;
};
export const forget = (): void => {
  remembered = null;
};
