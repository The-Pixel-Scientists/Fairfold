// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews of the applicant's journey: the round, the application, and the outcome.

import type { RouteDefinition } from '@pixel-scientists/ui';

import { SIGNED_OUT_PATH } from '../paths.ts';

export const applyRoutes: readonly RouteDefinition[] = [
  {
    path: '/round',
    title: 'Community Grants, Spring 2027',
    load: () => import('./Round.tsx'),
  },
  { path: '/application', title: 'Your application', load: () => import('./Application.tsx') },
  {
    path: '/application/organisation',
    title: 'Section 1 of 6: About your organisation',
    load: () => import('./Organisation.tsx'),
  },
  {
    path: '/application/project',
    title: 'Section 2 of 6: Your project',
    load: () => import('./Project.tsx'),
  },
  {
    path: '/application/budget',
    title: 'Section 3 of 6: Budget',
    load: () => import('./Budget.tsx'),
  },
  {
    path: '/application/outcomes',
    title: 'Section 4 of 6: Outcomes',
    load: () => import('./Outcomes.tsx'),
  },
  {
    path: '/application/documents',
    title: 'Section 5 of 6: Documents',
    load: () => import('./Documents.tsx'),
  },
  { path: '/application/check', title: 'Check your answers', load: () => import('./Check.tsx') },
  {
    path: '/application/submitted',
    title: 'Application submitted',
    load: () => import('./Submitted.tsx'),
  },
  { path: '/applications', title: 'Your applications', load: () => import('./Applications.tsx') },
  { path: '/outcome', title: 'Your outcome', load: () => import('./Outcome.tsx') },
  { path: '/outcome/letter', title: 'Your decision letter', load: () => import('./Letter.tsx') },
  { path: SIGNED_OUT_PATH, title: 'You have signed out', load: () => import('./SignedOut.tsx') },
];
