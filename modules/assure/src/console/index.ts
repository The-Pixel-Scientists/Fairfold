// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure module's staff screens: the queue of possible matches, a match
// with its decision, an organisation's registry details, checklists, visits
// and an application's flags and checklist answers. The console opens
// `/assure` with the default export; `assureConsoleRoutes` adds the pages
// under it. `RegistryPanel`, `FlagsPanel` and `ChecklistResponses` take one
// id, so a page in another module can show them without importing assure's
// pages.

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
  {
    path: '/assure/checklists',
    title: 'Checklists',
    load: () => import('./checklists/ChecklistsPage.tsx'),
  },
  {
    path: '/assure/checklists/new',
    title: 'Create checklist',
    load: () => import('./checklists/EditorPage.tsx'),
  },
  {
    path: '/assure/checklists/:checklistId',
    title: 'Edit checklist',
    params: ids,
    load: () => import('./checklists/EditorPage.tsx'),
  },
  { path: '/assure/visits', title: 'Visits', load: () => import('./visits/VisitsPage.tsx') },
  {
    path: '/assure/visits/new',
    title: 'Record a visit',
    load: () => import('./visits/VisitFormPage.tsx'),
  },
  {
    path: '/assure/visits/:visitId',
    title: 'Monitoring visit',
    params: ids,
    load: () => import('./visits/VisitFormPage.tsx'),
  },
  {
    path: '/assure/applications/:applicationId',
    title: 'Due diligence',
    params: ids,
    load: () => import('./ApplicationPage.tsx'),
  },
];

/** Loads the page when the section is first opened, so none of it is in the console's main code. */
export default lazy(() => import('./MatchesPage.tsx'));

export { LazyRegistryPanel as RegistryPanel } from './LazyRegistryPanel.tsx';
export {
  LazyFlagsPanel as FlagsPanel,
  LazyChecklistResponses as ChecklistResponses,
} from './LazyPanels.tsx';
