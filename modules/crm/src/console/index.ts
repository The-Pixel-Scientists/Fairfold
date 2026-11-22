// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The crm module's staff screens: search, organisation and person records.
// The console opens `/crm` with the default export, a page that loads when
// someone first opens the section; `crmConsoleRoutes` adds the pages under it.

import { idSchema } from '@pixel-scientists/domain';
import type { Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';

/** Only real ids are the addresses of records, so typing mistakes never reach the API. */
const ids: SearchSchema<Params> = {
  safeParse: (input) =>
    Object.values(input as Params).every((value) => idSchema.safeParse(value).success)
      ? { success: true, data: input as Params }
      : { success: false, error: null },
};

/** The kind of record in a compare address is one of the two kinds. */
const compareParams: SearchSchema<Params> = {
  safeParse: (input) => {
    const { kind, partyId, otherPartyId } = input as Params;
    return (kind === 'organisation' || kind === 'person') &&
      idSchema.safeParse(partyId).success &&
      idSchema.safeParse(otherPartyId).success
      ? { success: true, data: input as Params }
      : { success: false, error: null };
  },
};

export const crmConsoleRoutes: readonly RouteDefinition[] = [
  {
    path: '/crm/organisations/:organisationId',
    title: 'Organisation',
    params: ids,
    load: () => import('./OrganisationPage.tsx'),
  },
  {
    path: '/crm/people/:personId',
    title: 'Person',
    params: ids,
    load: () => import('./PersonPage.tsx'),
  },
  {
    path: '/crm/duplicates',
    title: 'Possible duplicates',
    load: () => import('./duplicates/DuplicatesPage.tsx'),
  },
  {
    path: '/crm/duplicates/:kind/:partyId/:otherPartyId',
    title: 'Compare records',
    params: compareParams,
    load: () => import('./duplicates/ComparePage.tsx'),
  },
  { path: '/crm/lists', title: 'Lists', load: () => import('./lists/ListsPage.tsx') },
  {
    path: '/crm/lists/:listId',
    title: 'List members',
    params: ids,
    load: () => import('./lists/ListPage.tsx'),
  },
  { path: '/crm/segments', title: 'Segments', load: () => import('./lists/SegmentsPage.tsx') },
  {
    path: '/crm/segments/:segmentId',
    title: 'Segment',
    params: ids,
    load: () => import('./lists/SegmentPage.tsx'),
  },
  {
    path: '/crm/imports/:importId',
    title: 'Import',
    params: ids,
    load: () => import('./import/ImportPage.tsx'),
  },
];

export { default } from './Landing.tsx';
