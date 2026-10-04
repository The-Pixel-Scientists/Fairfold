// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Calls to the approved definer functions of migration 0006 (ADR 0019).
// None of them sets a tenant, so run them outside withTenant(). Only
// createTenant() makes a TenantId: the id app.create_tenant() returns is ADR
// 0019's tenant source for the operator command, and Semgrep keeps every
// other caller out.

import type { LogoType, Preset } from '@pixel-scientists/domain/platform';
import { tenantNameSchema, type ThemeTokens } from '@pixel-scientists/domain/platform/settings';
import { sql, type Kysely } from 'kysely';

import { trustedTenantId } from './tenant-context.ts';

/** An active tenant's public face. Its id is not a TenantId and sets no tenant. */
export interface PublicTenantRow {
  readonly id: string;
  readonly name: string;
  readonly theme: ThemeTokens;
}

/** An active tenant's public face, or undefined for any other slug. As app_api or app_auth. */
export async function publicTenant<DB>(
  db: Kysely<DB>,
  slug: string,
): Promise<PublicTenantRow | undefined> {
  const { rows } = await sql<{
    id: string;
    name: string;
    brand_colour: string;
    preset: Preset;
    has_logo: boolean;
  }>`SELECT id, name, brand_colour, preset, has_logo FROM app.public_tenant(${slug})`.execute(db);
  const [row] = rows;
  return (
    row && {
      id: row.id,
      name: row.name,
      theme: { brandColour: row.brand_colour, preset: row.preset, hasLogo: row.has_logo },
    }
  );
}

/** An active tenant's logo and its checked type, or undefined. As app_api. */
export async function publicTenantLogo<DB>(
  db: Kysely<DB>,
  slug: string,
): Promise<{ logo: Buffer; logoType: LogoType } | undefined> {
  const { rows } = await sql<{ logo: Buffer; logo_type: LogoType }>`
    SELECT logo, logo_type FROM app.public_tenant_logo(${slug})
  `.execute(db);
  const [row] = rows;
  return row && { logo: row.logo, logoType: row.logo_type };
}

export interface SessionMembership {
  readonly membershipId: string;
  /** Not a TenantId: switching to it makes a new session (ADR 0010). */
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly roles: readonly string[];
}

/**
 * The active memberships, in active tenants, of the user of the live,
 * MFA-complete session whose token hashes to `tokenHash`; none otherwise.
 * As app_api.
 */
export async function sessionMemberships<DB>(
  db: Kysely<DB>,
  tokenHash: Uint8Array,
): Promise<SessionMembership[]> {
  const { rows } = await sql<{
    membership_id: string;
    tenant_id: string;
    slug: string;
    name: string;
    roles: string[];
  }>`
    SELECT membership_id, tenant_id, slug, name, roles
      FROM auth.session_memberships(${Buffer.from(tokenHash)})
  `.execute(db);
  return rows.map((row) => ({
    membershipId: row.membership_id,
    tenantId: row.tenant_id,
    slug: row.slug,
    name: row.name,
    roles: row.roles,
  }));
}

/**
 * Create a tenant and return its id, for the operator command alone, as
 * app_worker. The name must pass tenantNameSchema, and is stored trimmed;
 * the table's checks refuse a bad, reserved or taken slug.
 */
export async function createTenant<DB>(
  db: Kysely<DB>,
  tenant: { readonly slug: string; readonly name: string },
) {
  const name = tenantNameSchema.parse(tenant.name);
  const { rows } = await sql<{ id: string }>`
    SELECT app.create_tenant(${tenant.slug}, ${name}) AS id
  `.execute(db);
  const id = rows[0]?.id;
  if (!id) throw new Error('app.create_tenant() returned no id.');
  return trustedTenantId(id);
}
