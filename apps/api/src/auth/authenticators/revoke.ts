// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Ending what could still act for a user after an account change (ADR 0010,
// "Sessions"). An MFA change, deactivation or clearing MFA revokes every
// session and device cookie; a password change revokes every other session
// and every device cookie, and the session that made it goes on under a new
// id and token. Each runs in the change's transaction, as app_auth, after
// lockForChange() or another exclusive lock on the user, and records one
// sessions_revoked event with the reason. The caller copies the event to
// the tenant audit log once the transaction commits.

import type { Transaction } from '@pixel-scientists/db';

import type { RequestSession } from '../../context.ts';
import { ApiError } from '../../problems.ts';
import { recordAuthEvent, type AuthEvent } from '../events.ts';
import { revokeDevices } from '../limits/devices.ts';
import {
  detailsOf,
  lockSession,
  lockUser,
  revokeAll,
  rotateSession,
  type StoredSession,
} from '../sessions.ts';
import { factorsOf } from './guard.ts';

/** Where a revocation is recorded: the request, and the tenant of the acting session if any. */
export interface RevokeContext {
  readonly requestId: string;
  readonly tenant?: string;
  readonly ip?: string;
}

const FACTOR_REQUIRED = 'Confirm it is you with your authenticator app, then try again.';

export interface Revoked {
  readonly sessions: number;
  readonly devices: number;
  readonly event: AuthEvent;
}

/**
 * Lock the request's user exclusively, so no session is issued or changed
 * for them meanwhile, then its session, which must still be live. If the
 * user holds a factor, the session must have proven it ('complete'): a
 * password alone never changes the factor or password guarding an account.
 */
export async function lockForChange(
  trx: Transaction<unknown>,
  session: RequestSession,
): Promise<StoredSession> {
  await lockUser(trx, session.userId, 'update');
  const current = await lockSession(trx, session.userId, detailsOf(session).tokenHash);
  if (current === undefined) throw new ApiError(401, undefined, { reason: 'no_session' });
  if (current.mfa_state !== 'complete' && (await factorsOf(trx, session.userId)).length > 0) {
    throw new ApiError(403, FACTOR_REQUIRED, { reason: 'factor_required' });
  }
  return current;
}

/** Revoke every session and device cookie of the user, and record it with `reason`. */
export async function revokeAllForUser(
  trx: Transaction<unknown>,
  userId: string,
  reason: string,
  at: RevokeContext,
): Promise<Revoked> {
  const sessions = await revokeAll(trx, { userId });
  const devices = await revokeDevices(trx, userId);
  const event = await recordAuthEvent(trx, 'sessions_revoked', { ...at, userId, reason });
  return { sessions, devices, event };
}

/**
 * Revoke every session and device cookie of the user of `keep`, a session
 * locked by lockForChange(), and replace `keep` with a new session for the
 * same browser. Returns the new session's token; `sessions` counts the others.
 */
export async function revokeOthersForUser(
  trx: Transaction<unknown>,
  keep: StoredSession,
  reason: string,
  at: RevokeContext & { readonly ip: string; readonly userAgent?: string | undefined },
): Promise<Revoked & { readonly token: string }> {
  const revoked = await revokeAllForUser(trx, keep.user_id, reason, at);
  const token = await rotateSession(trx, keep, { ip: at.ip, userAgent: at.userAgent });
  return { ...revoked, sessions: revoked.sessions - 1, token };
}
