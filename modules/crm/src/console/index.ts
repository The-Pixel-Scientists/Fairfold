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
];

export { default } from './Landing.tsx';
