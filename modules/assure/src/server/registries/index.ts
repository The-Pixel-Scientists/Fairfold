// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Registry lookups (ADR 0031): the adapters, the lookup routes' handlers and
// the refresh job's handler. `createRegistryAdapters` has no database, tenant or audit
// writer, so the lookup widget can use it alone.

export { createRegistryAdapters, type RegistryAdapters, type RegistryKeys } from './adapters.ts';
export { registryHandlers, type RegistryContext, type RegistryDependencies } from './handlers.ts';
export {
  REFRESH_QUEUE,
  registryRefresh,
  type QueueRefresh,
  type RefreshAuditEvent,
  type RefreshDependencies,
  type RefreshFailureCode,
  type RefreshJob,
} from './refresh.ts';
export { readRegistryKeys, registersOff } from './settings.ts';
