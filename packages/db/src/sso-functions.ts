// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The call to auth.sso_providers_by_key_version() (migration 0027, ADR 0003
// "Approved definer functions"). Its tenant ids are ADR 0003's tenant source
// 4 for the secret re-encryption command, so it makes TenantIds. The
// package's entry point leaves it out: only that command imports it, and
// Semgrep keeps every other caller out.

import { sql, type Kysely } from 'kysely';

import { trustedTenantId, type TenantId } from './tenant-context.ts';

/** The SSO providers whose secrets the key of `version` sealed, in every tenant. As app_auth. */
export async function ssoProvidersByKeyVersion<DB>(
  db: Kysely<DB>,
  version: number,
): Promise<{ readonly id: string; readonly tenant: TenantId }[]> {
  const { rows } = await sql<{ id: string; tenant_id: string }>`
    SELECT id, tenant_id FROM auth.sso_providers_by_key_version(${version})
  `.execute(db);
  return rows.map(({ id, tenant_id }) => ({ id, tenant: trustedTenantId(tenant_id) }));
}
