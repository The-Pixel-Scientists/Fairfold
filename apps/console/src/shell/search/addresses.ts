// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where each kind of search result opens, inside the funder's address. The
// address holds the record's id and nothing else. A kind with no page yet is
// listed as excluded, and its results are not shown.

import { reviewerKinds } from '@pixel-scientists/domain/platform/search';

type Address = ((id: string) => string) | { excluded: string };

export const searchAddresses: Readonly<Record<string, Address>> = {
  'grants.application': (id) => `/submissions/${id}`,
  // The organisation, person and contact pages arrive with the crm screens (S12-42).
  'party.organisation': { excluded: 'No page opens an organisation until S12-42.' },
  'party.person': { excluded: 'No page opens a person until S12-42.' },
  'crm.contact': { excluded: 'No page opens a contact until S12-42.' },
};

/** The address a result opens, or null when its kind has no page. */
export function addressFor(kind: string, id: string): string | null {
  const address = searchAddresses[kind];
  return typeof address === 'function' ? address(id) : null;
}

/** The kinds a reviewer is sent, each of which needs an address or an exclusion. */
export const reviewerKindsToCover: readonly string[] = reviewerKinds;
