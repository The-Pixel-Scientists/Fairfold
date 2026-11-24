// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Due diligence checklists (rule 10). `templateHandlers` serves the routes that
// list, read, create and publish checklists, and `responseHandlers` those that
// list, read and save an application's answers, for apps/api/src/modules/assure.ts
// alone, which passes in what the platform gives a handler.

export { responseHandlers } from './responses.ts';
export { templateHandlers } from './templates.ts';
export type { Applicant, ChecklistContext, ChecklistDependencies } from './context.ts';
