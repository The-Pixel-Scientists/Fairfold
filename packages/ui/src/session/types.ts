// SPDX-License-Identifier: AGPL-3.0-or-later

/** A membership as these components need it. The API's membership has more, and fits. */
export interface SessionMembership {
  readonly id: string;
  readonly tenant: { readonly slug: string; readonly name: string };
}

/**
 * What these components need of a session. The domain package's `Session`
 * fits it, so the library does not import the API contracts: the app passes
 * in the functions that read and end the session.
 */
export interface SessionData {
  /** Whether MFA is still to come (`enrol`, `verify`), or settled (`complete`, `not_required`). */
  readonly mfa: 'enrol' | 'verify' | 'complete' | 'not_required';
  /** When the session ends unless used (ISO 8601). */
  readonly expiresAt: string;
  readonly user: { readonly email: string };
  readonly permissions: readonly string[];
  readonly activeMembership: SessionMembership | null;
  readonly memberships: readonly SessionMembership[];
}

export type SessionState =
  | { readonly status: 'loading' }
  /** The session could not be read, which says nothing about whether there is one. */
  | { readonly status: 'failed' }
  /** Nobody is signed in. `reason` says why when the person was signed out, not just absent. */
  | { readonly status: 'signed-out'; readonly reason: 'timeout' | 'signed-out' | null }
  | { readonly status: 'ready'; readonly session: SessionData };

/** True when the session holds the permission. Permissions come from the active membership. */
export function hasPermission(
  session: Pick<SessionData, 'permissions'>,
  permission: string,
): boolean {
  return session.permissions.includes(permission);
}
