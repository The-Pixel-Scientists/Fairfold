// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's server entry point (ADR 0016). `grantsHandlers` is for
// apps/api/src/modules.ts alone, which registers the routes.
// `grantsSubjectRules` is for the platform's audit writer alone. `grantsWarehouse`
// feeds the warehouse snapshot. `grantsSubjectData` serves subject access.

export {
  grantsHandlers,
  grantsResolvers,
  type AssessmentDependencies,
  type ConfigHistoryRow,
  type DecisionDependencies,
  type GrantsContext,
  type GrantsDependencies,
  type MailSender,
} from './routes.ts';
export { grantsSubjectRules } from './audit.ts';
export { grantsWarehouse } from './warehouse.ts';
export { grantsSubjectData } from './subject-data.ts';
