// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The last-factor rule (ADR 0010: MFA is mandatory for staff). A factor may
// be removed only if the account keeps another one, or holds no staff
// membership. Staff means an active membership, in any active tenant, whose
// roles grant a console permission, read through auth.session_memberships()
// (D21) for the request's own session, never from the session's app or the
// request. Backup codes never count as the remaining factor: they are a way
// back in, not a second factor. Each passkey counts, since every one was
// registered with user verification (passkeys/store.ts).

import { sessionMemberships, type Kysely, type Transaction } from '@pixel-scientists/db';
import { permissionsFor } from '@pixel-scientists/domain/platform';

import type { RequestSession } from '../../context.ts';
import { ApiError } from '../../problems.ts';
import { passkeyCount } from '../passkeys/store.ts';
import { detailsOf } from '../sessions.ts';
import type { AuthTables } from '../tables.ts';

export type Factor = 'totp' | 'passkey';

const LAST_FACTOR =
  'You need another authenticator to sign in to the staff console. Add one first, then remove this one.';

/** The factors the user holds, one for each passkey, read in `trx` as app_auth. */
export async function factorsOf(trx: Transaction<unknown>, userId: string): Promise<Factor[]> {
  const totp = await trx
    .$extendTables<AuthTables>()
    .selectFrom('auth.two_factor')
    .select('user_id')
    .where('user_id', '=', userId)
    .where('verified', '=', true)
    .executeTakeFirst();
  const passkeys = Array<Factor>(await passkeyCount(trx, userId)).fill('passkey');
  return totp === undefined ? passkeys : ['totp', ...passkeys];
}

/**
 * Throws unless the user of `session` may remove `factor`. Call it in the
 * removal's transaction, after lockForChange(). `api` is app_api, the only
 * role that may call auth.session_memberships().
 */
export async function assertMayRemoveFactor(
  trx: Transaction<unknown>,
  api: Kysely<unknown>,
  session: RequestSession,
  factor: Factor,
): Promise<void> {
  const others = await factorsOf(trx, session.userId);
  const removed = others.indexOf(factor);
  if (removed >= 0) others.splice(removed, 1);
  if (others.length > 0) return;
  const memberships = await sessionMemberships(api, detailsOf(session).tokenHash);
  // No membership means the session is no longer live: fail closed.
  if (memberships.length === 0) throw new ApiError(401, undefined, { reason: 'no_session' });
  if (memberships.some(({ roles }) => permissionsFor(roles, 'console').length > 0)) {
    throw new ApiError(409, LAST_FACTOR, { reason: 'last_factor' });
  }
}
