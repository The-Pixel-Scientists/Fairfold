// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews of the applicant's journey: the round, the application, and the outcome.

import type { RouteDefinition } from '@pixel-scientists/ui';

export const applyRoutes: readonly RouteDefinition[] = [
  {
    path: '/round',
    title: 'Community Grants, Spring 2027',
    load: () => import('./Round.tsx'),
  },
  { path: '/application', title: 'Your application', load: () => import('./Application.tsx') },
  {
    path: '/application/budget',
    title: 'Section 3 of 6: Budget',
    load: () => import('./Budget.tsx'),
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
];
