// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The addresses of the crm pages, inside the funder's address.

export const CRM_PATH = '/crm';

export const organisationPath = (organisationId: string) => `/crm/organisations/${organisationId}`;
export const personPath = (personId: string) => `/crm/people/${personId}`;

export const DUPLICATES_PATH = '/crm/duplicates';
export const LISTS_PATH = '/crm/lists';
export const SEGMENTS_PATH = '/crm/segments';

export const comparePath = (kind: 'organisation' | 'person', partyId: string, otherId: string) =>
  `/crm/duplicates/${kind}/${partyId}/${otherId}`;
export const listPath = (listId: string) => `/crm/lists/${listId}`;
export const segmentPath = (segmentId: string) => `/crm/segments/${segmentId}`;
export const importPath = (importId: string) => `/crm/imports/${importId}`;
