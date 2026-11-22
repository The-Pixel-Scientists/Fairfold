// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure module's staff screens: the queue of possible matches, a match
// with its decision, and an organisation's registry details. The console
// opens `/assure` with the default export; `assureConsoleRoutes` adds the
// pages under it. `RegistryPanel` takes an organisation id, so a page in
// another module can show it without importing assure's pages.

import { idSchema } from '@pixel-scientists/domain';
import type { Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';
import { lazy } from 'react';

/** Only real ids are the addresses of records, so typing mistakes never reach the API. */
const ids: SearchSchema<Params> = {
  safeParse: (input) =>
    Object.values(input as Params).every((value) => idSchema.safeParse(value).success)
      ? { success: true, data: input as Params }
      : { success: false, error: null },
};

export const assureConsoleRoutes: readonly RouteDefinition[] = [
  { path: '/assure/matches', title: 'Possible matches', load: () => import('./MatchesPage.tsx') },
  {
    path: '/assure/matches/:matchId',
    title: 'Possible match',
    params: ids,
    load: () => import('./MatchPage.tsx'),
  },
  {
    path: '/assure/organisations/:organisationId',
    title: 'Registry details',
    params: ids,
    load: () => import('./OrganisationLookupsPage.tsx'),
  },
];

/** Loads the page when the section is first opened, so none of it is in the console's main code. */
export default lazy(() => import('./MatchesPage.tsx'));

export { LazyRegistryPanel as RegistryPanel } from './LazyRegistryPanel.tsx';
