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
// cannot reach.

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
export { assureErasure } from './erasure.ts';
export { assureSubjectData } from './subject-data.ts';
