// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The database package's public entry point. trustedTenantId() is left out
// on purpose: only the trusted tenant sources may create a TenantId.

export {
  CLIENT_ROLES,
  createDatabase,
  type ClientRole,
  type DatabaseLog,
  type DatabaseSettings,
  type DatabaseTls,
} from './database.ts';
export { TenantLeakError, withTenant, type TenantId } from './tenant-context.ts';
