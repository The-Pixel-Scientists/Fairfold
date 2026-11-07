// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The console's modules (ADR 0016): one entry for each tool that has staff
// screens. Adding a tool means one entry here. A tool's screens live in its
// own package and load only when one of its addresses is first opened.

import type { SwitchableModuleId } from '@pixel-scientists/domain/platform';
import type { ComponentType } from 'react';

/** What a tool's `console` entry may export: the page its landing path opens. */
export interface ConsoleEntry {
  default?: ComponentType;
}

export interface ConsoleModule {
  id: SwitchableModuleId;
  /** Where the tool's section opens, inside the funder's address. */
  path: string;
  /**
   * Imports the tool's console package. Grants has none: its routes and
   * navigation are `grantsRoutes` and `grantsNavigation`.
   */
  load?: () => Promise<ConsoleEntry>;
}

/** In the order the navigation shows them, which never changes as tools are switched on. */
export const consoleModules: readonly ConsoleModule[] = [
  { id: 'grants', path: '/' },
  { id: 'crm', path: '/crm', load: () => import('@pixel-scientists/crm/console') },
  { id: 'assure', path: '/assure', load: () => import('@pixel-scientists/assure/console') },
  { id: 'forms', path: '/forms', load: () => import('@pixel-scientists/forms/console') },
  { id: 'privacy', path: '/privacy', load: () => import('@pixel-scientists/privacy/console') },
  { id: 'insight', path: '/insight', load: () => import('@pixel-scientists/insight/console') },
];
