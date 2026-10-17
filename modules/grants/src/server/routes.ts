// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's route handlers (ADR 0016). Each route group adds its
// handlers here. They are matched with their contracts, and their scope
// rules registered, in apps/api/src/modules.ts.

import { applicationHandlers } from './applications/handlers.ts';
import { grantsResolvers as applicationResolvers } from './applications/resolvers.ts';
import { assessmentHandlers } from './assessment/handlers.ts';
import type { AssessmentDependencies } from './assessment/context.ts';
import { assessmentResolvers } from './assessment/resolvers.ts';
import type { FormDependencies } from './forms/context.ts';
import { formHandlers } from './forms/handlers.ts';
import type { GrantsDependencies } from './programme/context.ts';
import { programmeSetUpHandlers } from './programme/handlers.ts';
import { submissionHandlers } from './submissions/handlers.ts';

export type { AssessmentDependencies } from './assessment/context.ts';
export type { FormDependencies } from './forms/context.ts';
export type { ConfigHistoryRow, GrantsContext, GrantsDependencies } from './programme/context.ts';

/** The scope rules the module resolves. */
export const grantsResolvers = { ...applicationResolvers, ...assessmentResolvers };

export function grantsHandlers(
  deps: GrantsDependencies & FormDependencies & AssessmentDependencies,
) {
  return {
    ...programmeSetUpHandlers(deps),
    ...formHandlers(deps),
    ...applicationHandlers(deps),
    ...submissionHandlers(deps),
    ...assessmentHandlers(deps),
  };
}
