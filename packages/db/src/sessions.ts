// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading and touching a session by its token's hash (migration 0004, ADR
// 0010). sessionContext() is the trusted source of a session's tenant (ADR
// 0003), so it alone here makes a TenantId. Run both outside withTenant().

import { sql, type Kysely } from 'kysely';

import { trustedTenantId, type TenantId } from './tenant-context.ts';

export interface SessionContextRow {
  readonly userId: string;
  readonly tenant: TenantId;
  readonly app: 'console' | 'portal';
  readonly mfaState: 'enrol' | 'verify' | 'complete' | 'not_required';
  /** When the session ends unless used. */
  readonly expiresAt: Date;
  readonly reauthenticatedAt: Date | null;
}

/**
 * The live session whose token hashes to `tokenHash`, through
 * auth.session_context(), as app_api. Undefined for any other hash, and for
 * a session with no active tenant.
 */
export async function sessionContext<DB>(
  db: Kysely<DB>,
  tokenHash: Uint8Array,
): Promise<SessionContextRow | undefined> {
  const { rows } = await sql<{
    user_id: string;
    active_tenant_id: string | null;
    app: SessionContextRow['app'];
    mfa_state: SessionContextRow['mfaState'];
    expires_at: Date;
    reauthenticated_at: Date | null;
  }>`
    SELECT user_id, active_tenant_id, app, mfa_state, expires_at, reauthenticated_at
      FROM auth.session_context(${Buffer.from(tokenHash)})
  `.execute(db);
  const [row] = rows;
  if (!row?.active_tenant_id) return undefined;
  return {
    userId: row.user_id,
    tenant: trustedTenantId(row.active_tenant_id),
    app: row.app,
    mfaState: row.mfa_state,
    expiresAt: row.expires_at,
    reauthenticatedAt: row.reauthenticated_at,
  };
}

/**
 * Record that the session was used, at most once a minute, as app_auth.
 * A revoked session is left as it is.
 */
export async function touchSession<DB>(db: Kysely<DB>, tokenHash: Uint8Array): Promise<void> {
  await sql`
    UPDATE auth.session SET last_seen_at = now()
     WHERE token_hash = ${Buffer.from(tokenHash)}
       AND revoked_at IS NULL
       AND last_seen_at < now() - interval '1 minute'
  `.execute(db);
}
