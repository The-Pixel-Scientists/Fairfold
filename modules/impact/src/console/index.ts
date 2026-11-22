// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The impact module's staff screens: outcomes frameworks with their targets,
// results and learning notes. The console opens `/impact` with the default
// export, a page that loads when someone first opens the section; `impactConsoleRoutes`
// adds the pages under it.

import { idSchema } from '@pixel-scientists/domain';
import type { Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';

import { NEW_FRAMEWORK_PATH } from './paths.ts';

/** Only real ids are the addresses of frameworks, so `/impact/new` and typing mistakes never reach them. */
const ids: SearchSchema<Params> = {
  safeParse: (input) =>
    Object.values(input as Params).every((value) => idSchema.safeParse(value).success)
      ? { success: true, data: input as Params }
      : { success: false, error: null },
};

export const impactConsoleRoutes: readonly RouteDefinition[] = [
  {
    path: NEW_FRAMEWORK_PATH,
    title: 'New framework',
    load: () => import('./NewFrameworkPage.tsx'),
  },
  {
    path: '/impact/:frameworkId',
    title: 'Outcomes framework',
    params: ids,
    load: () => import('./FrameworkPage.tsx'),
  },
  {
    path: '/impact/:frameworkId/edit',
    title: 'Edit framework',
    params: ids,
    load: () => import('./EditFrameworkPage.tsx'),
  },
];

export { default } from './Landing.tsx';
