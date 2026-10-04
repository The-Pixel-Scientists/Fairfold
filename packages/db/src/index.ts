// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The database package's public entry point. trustedTenantId() is left out
// on purpose: only the trusted tenant sources may create a TenantId.

export type { Transaction } from 'kysely';

export {
  insertAuditEvent,
  type AuditChanges,
  type AuditEventRow,
  type FieldChange,
} from './audit.ts';
export {
  CLIENT_ROLES,
  createDatabase,
  type ClientRole,
  type DatabaseLog,
  type DatabaseSettings,
  type DatabaseTls,
} from './database.ts';
export { TenantLeakError, withTenant, type TenantId } from './tenant-context.ts';
export {
  createTenant,
  publicTenant,
  publicTenantLogo,
  sessionMemberships,
  type PublicTenantRow,
  type SessionMembership,
} from './tenant-functions.ts';
