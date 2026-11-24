// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's server entry point (ADR 0016). `formsPublicHandlers` is
// for apps/api/src/modules.ts alone, which registers the anonymous routes
// and passes in what they need from the platform. `warehouseAnswers` is the
// rule for what forms may send the warehouse. `formsStaffHandlers` is for the
// same file alone, which registers the console routes for forms, drafts,
// versions and templates and passes in the store they read and write through.

export type {
  PublicArgs,
  PublicDependencies,
  PublicFormBucket,
  PublicFormRecord,
  PublicProblem,
  PublicRead,
  PublicSubmission,
  SubmitArgs,
  SubmitResult,
} from './public/context.ts';
export { publicFormBuckets } from './public/context.ts';
export { publicHandlers as formsPublicHandlers } from './public/handlers.ts';
export { staffHandlers as formsStaffHandlers } from './staff/index.ts';
export type {
  DraftRow,
  FormRow,
  StaffContext,
  StaffDependencies,
  StaffStore,
  VersionRow,
} from './staff/index.ts';
export { warehouseAnswers } from './warehouse.ts';
