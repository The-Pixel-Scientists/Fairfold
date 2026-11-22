// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's server entry point (ADR 0016). `formsPublicHandlers` is
// for apps/api/src/modules.ts alone, which registers the anonymous routes
// and passes in what they need from the platform. `warehouseAnswers` is the
// rule for what forms may send the warehouse.

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
export { warehouseAnswers } from './warehouse.ts';
