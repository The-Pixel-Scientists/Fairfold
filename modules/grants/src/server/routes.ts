// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's route handlers (ADR 0016). Each route group adds its
// handlers here. They are matched with their contracts, and their scope
// rules registered, in apps/api/src/modules.ts.

import type { GrantsDependencies } from './programme/context.ts';
import { programmeSetUpHandlers } from './programme/handlers.ts';

export type { ConfigHistoryRow, GrantsContext, GrantsDependencies } from './programme/context.ts';

export function grantsHandlers(deps: GrantsDependencies) {
  return { ...programmeSetUpHandlers(deps) };
}
