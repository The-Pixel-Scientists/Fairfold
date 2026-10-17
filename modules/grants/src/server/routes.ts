// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's route handlers (ADR 0016). Each route group adds its
// handlers here. They are matched with their contracts, and their scope
// rules registered, in apps/api/src/modules.ts.

import type { FormDependencies } from './forms/context.ts';
import { formHandlers } from './forms/handlers.ts';
import type { GrantsDependencies } from './programme/context.ts';
import { programmeSetUpHandlers } from './programme/handlers.ts';

export type { FormDependencies } from './forms/context.ts';
export type { ConfigHistoryRow, GrantsContext, GrantsDependencies } from './programme/context.ts';

export function grantsHandlers(deps: GrantsDependencies & FormDependencies) {
  return { ...programmeSetUpHandlers(deps), ...formHandlers(deps) };
}
