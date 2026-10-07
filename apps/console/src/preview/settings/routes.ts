// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design previews: Settings.

import type { RouteDefinition } from '@pixel-scientists/ui';

export const settingsRoutes: readonly RouteDefinition[] = [
  { path: '/settings', title: 'Settings', load: () => import('./Settings.tsx') },
];
