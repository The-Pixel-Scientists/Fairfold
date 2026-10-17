// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's staff screens: the routes the console adds under a
// funder's address, and the pages they put in its navigation. Programme
// set-up is here; later grants screens extend both lists.

import { idSchema } from '@pixel-scientists/domain';
import type { Permission } from '@pixel-scientists/domain/platform';
import type { Params, RouteDefinition, SearchSchema } from '@pixel-scientists/ui';

import { NEW_PROGRAMME_PATH, PROGRAMMES_PATH } from './programme/paths.ts';

/** Only real ids are the addresses of programmes, rounds and stages, so `/programmes/new` and typing mistakes never reach them. */
const ids: SearchSchema<Params> = {
  safeParse: (input) =>
    Object.values(input as Params).every((value) => idSchema.safeParse(value).success)
      ? { success: true, data: input as Params }
      : { success: false, error: null },
};

/** Pages for someone who can set up programmes. Each page says so itself when the person cannot. */
export const grantsRoutes: readonly RouteDefinition[] = [
  {
    path: PROGRAMMES_PATH,
    title: 'Programmes',
    load: () => import('./programme/ProgrammesPage.tsx'),
  },
  {
    path: NEW_PROGRAMME_PATH,
    title: 'New programme',
    load: () => import('./programme/NewProgrammePage.tsx'),
  },
  {
    path: '/programmes/:programmeId',
    title: 'Programme',
    params: ids,
    load: () => import('./programme/ProgrammePage.tsx'),
  },
  {
    path: '/programmes/:programmeId/edit',
    title: 'Edit programme',
    params: ids,
    load: () => import('./programme/EditProgrammePage.tsx'),
  },
  {
    path: '/programmes/:programmeId/emails',
    title: 'Outcome emails',
    params: ids,
    load: () => import('./programme/EmailsPage.tsx'),
  },
  {
    path: '/programmes/:programmeId/rounds/new',
    title: 'New round',
    params: ids,
    load: () => import('./programme/NewRoundPage.tsx'),
  },
  {
    path: '/rounds/:roundId',
    title: 'Round',
    params: ids,
    load: () => import('./programme/RoundPage.tsx'),
  },
  {
    path: '/rounds/:roundId/edit',
    title: 'Edit round',
    params: ids,
    load: () => import('./programme/EditRoundPage.tsx'),
  },
  {
    path: '/rounds/:roundId/stages',
    title: 'Stages',
    params: ids,
    load: () => import('./programme/StagesPage.tsx'),
  },
  {
    path: '/rounds/:roundId/stages/:stageId/rubric',
    title: 'Rubric',
    params: ids,
    load: () => import('./programme/RubricPage.tsx'),
  },
];

/** What the console's navigation lists for grants, each shown only to a session that holds its permission. */
export const grantsNavigation = [
  { to: PROGRAMMES_PATH, label: 'Programmes', permission: 'grants.programmes.manage' },
] as const satisfies readonly { to: string; label: string; permission: Permission }[];
