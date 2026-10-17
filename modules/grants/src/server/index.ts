// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's server entry point (ADR 0016). `grantsHandlers` is for
// apps/api/src/modules.ts alone, which registers the routes.

export {
  grantsHandlers,
  grantsResolvers,
  type AssessmentDependencies,
  type ConfigHistoryRow,
  type GrantsContext,
  type GrantsDependencies,
} from './routes.ts';
