// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews: Decisions, release, reports, data out and the platform.

import type { RouteDefinition } from '@pixel-scientists/ui';

export const decideRoutes: readonly RouteDefinition[] = [
  { path: '/decisions', title: 'Decisions', load: () => import('./Decisions.tsx') },
  {
    path: '/decisions/release',
    title: 'Release decisions',
    load: () => import('./Release.tsx'),
  },
  { path: '/reports', title: 'Reports and data', load: () => import('./Reports.tsx') },
  { path: '/organisations', title: 'Organisations', load: () => import('./Organisations.tsx') },
  {
    path: '/organisations/northfield-community-trust',
    title: 'Northfield Community Trust',
    load: () => import('./Organisation.tsx'),
  },
  { path: '/team', title: 'Team', load: () => import('./Team.tsx') },
  { path: '/audit', title: 'Audit log', load: () => import('./Audit.tsx') },
];
