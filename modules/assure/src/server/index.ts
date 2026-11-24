// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure module's server entry point (ADR 0016). `registryHandlers`
// serves the lookup routes, and `registryRefresh` is the handler of the
// `assure.registry_refresh` queue (REFRESH_QUEUE), both for
// apps/api/src/modules.ts and the worker alone: apps/api defines the queue
// and passes in what sends to it. `assureSubjectData` and `assureErasure`
// serve subject access and erasure, and run whether or not a tenant has the
// module on. `readRegistryKeys` and `createRegistryAdapters` build the
// adapters at start-up, and `registersOff` names the registers a deployment
// cannot reach. `screeningHandlers` serves the screening and match routes,
// `screeningJob` is the handler of the `assure.screening` queue (SCREENING_QUEUE),
// `submissionSubscriber` of the event queue's submission events (wired
// through defineEventHandler('assure', ...)) and
// `sanctionsListRefresh` of the daily list download, all for apps/api alone.
// `templateHandlers` and `responseHandlers` serve the checklist routes,
// `duplicateHandlers` the duplicate flag routes and `visitHandlers` the
// monitoring visit routes.

export {
  createRegistryAdapters,
  readRegistryKeys,
  registersOff,
  REFRESH_QUEUE,
  registryHandlers,
  registryRefresh,
  type QueueRefresh,
  type RefreshAuditEvent,
  type RefreshDependencies,
  type RefreshFailureCode,
  type RefreshJob,
  type RegistryAdapters,
  type RegistryContext,
  type RegistryDependencies,
  type RegistryKeys,
} from './registries/index.ts';
export {
  LIST_URL,
  readListUrl,
  sanctionsListRefresh,
  SCREENING_QUEUE,
  screeningHandlers,
  screeningJob,
  submissionSubscriber,
  type Fetcher as ListFetcher,
  type IngestDependencies,
  type IngestFailureCode,
  type IngestJob,
  type MatchFound,
  type PartyName,
  type PartyReader,
  type RunAuditEvent,
  type ScreeningContext,
  type ScreeningDependencies,
  type ScreeningFailureCode,
  type ScreeningJob,
  type ScreeningRouteDependencies,
  type SubmissionDependencies,
  type SubmissionJob,
} from './screening/index.ts';
export {
  responseHandlers,
  templateHandlers,
  type Applicant,
  type ChecklistContext,
  type ChecklistDependencies,
} from './checklists/index.ts';
export {
  duplicateHandlers,
  type DuplicateContext,
  type DuplicateDependencies,
} from './duplicates/index.ts';
export { visitHandlers } from './visits/index.ts';
export { assureErasure } from './erasure.ts';
export { assureSubjectData } from './subject-data.ts';
