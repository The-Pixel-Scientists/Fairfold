// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews: insight, from the round dashboard to the data warehouse.

import type { RouteDefinition } from '@pixel-scientists/ui';

export const insightRoutes: readonly RouteDefinition[] = [
  { path: '/insight', title: 'Round dashboard', load: () => import('./RoundDashboard.tsx') },
  { path: '/insight/equality', title: 'Equality monitoring', load: () => import('./Equality.tsx') },
  {
    path: '/insight/geography',
    title: 'Where the money goes',
    load: () => import('./Geography.tsx'),
  },
  {
    path: '/insight/reviewers',
    title: 'Reviewer calibration',
    load: () => import('./Reviewers.tsx'),
  },
  {
    path: '/insight/warehouse',
    title: 'Your data warehouse',
    load: () => import('./Warehouse.tsx'),
  },
];
