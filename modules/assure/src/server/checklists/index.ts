// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Due diligence checklists (rule 10). `templateHandlers` serves the routes that
// list, read, create and publish checklists, for apps/api/src/modules/assure.ts
// alone, which passes in what the platform gives a handler.

export { templateHandlers } from './templates.ts';
export type { Applicant, ChecklistContext, ChecklistDependencies } from './context.ts';
