// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The single-use token that proves a new email address (ADR 0010). It is 256
// random bits, kept in auth.verification only as its HMAC-SHA-256 under the
// email change purpose key, which HKDF-SHA-256 derives from the auth secret,
// for 1 hour on the database's clock. The row binds the user, the tenant of
// the session that asked, and the new address. A new request replaces any
// pending token of the user, and none is issued once the session that asked
// is revoked. Spending deletes the row in the caller's transaction, so of two
// completions with one token only one finds it. A token issued before the
// account was recovered or signed out everywhere is refused (recoveredSince).
// The tenant read back from a spent token is trusted: only app_auth writes
// these rows, and only from the verified session that asked.

import { createHmac, hkdfSync } from 'node:crypto';

import type { Kysely, TenantId, Transaction } from '@pixel-scientists/db';
import type { AuthEventCode } from '@pixel-scientists/domain/auth';

import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';

import type { Secret } from '../../config.ts';
import { newToken } from '../cookies.ts';
import { lockSession } from '../sessions.ts';
import type { AuthTables } from '../tables.ts';

const PREFIX = 'email_change:';
const VALUE = /^email_change:([0-9a-f-]{36}):([0-9a-f-]{36}):(.+)$/;
const LINK = '1 hour';

/** Events that end what could act for the user, each cancelling a change asked for before it. */
const RECOVERIES: readonly AuthEventCode[] = [
  'sessions_revoked',
  'password_reset_completed',
  'password_changed',
  'mfa_removed',
];

type Times = {
  'auth.verification': { created_at: Date };
  'auth.audit_event': { occurred_at: Date };
};

export interface EmailChange {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly email: string;
}

/** A token's verification identifier: its HMAC in unpadded base64url, 43 characters. */
export function tokenIdentifier(secret: Secret): (token: string) => string {
  const key = Buffer.from(hkdfSync('sha256', secret.reveal(), '', 'tps-auth-email-change', 32));
  return (token) => createHmac('sha256', key).update(token, 'utf8').digest('base64url');
}

/**
 * Issue a token for `change`, as app_auth, replacing any pending one of the
 * user; none if the session that asked, whose token hashes to `session`, has
 * been revoked. Its shared lock on the user orders it against a revocation.
 */
export async function issueToken(
  auth: Kysely<unknown>,
  identify: (token: string) => string,
  change: EmailChange,
  session: Buffer,
): Promise<string | undefined> {
  const token = newToken();
  const owner = `${PREFIX}${change.userId}:`;
  const issued = await auth.transaction().execute(async (trx) => {
    const db = trx.$extendTables<AuthTables>();
    await db
      .selectNoFrom((eb) =>
        eb.fn('pg_advisory_xact_lock', [eb.fn('hashtext', [eb.val(owner)])]).as('locked'),
      )
      .execute();
    await db
      .deleteFrom('auth.verification')
      .where((eb) => eb(eb.fn('starts_with', ['value', eb.val(owner)]), '=', true))
      .execute();
    if ((await lockSession(trx, change.userId, session)) === undefined) return false;
    await db
      .insertInto('auth.verification')
      .values((eb) => ({
        identifier: identify(token),
        value: `${owner}${change.tenantId}:${change.email}`,
        expires_at: eb.fn<Date>('date_add', [eb.fn('now'), eb.val(LINK)]),
      }))
      .execute();
    return true;
  });
  return issued ? token : undefined;
}

/** Spend a live token in `trx`, as app_auth, and say what it was for and when; undefined if none. */
export async function spendToken(
  trx: Transaction<unknown>,
  identify: (token: string) => string,
  token: string,
): Promise<(EmailChange & { readonly issuedAt: Date }) | undefined> {
  const spent = await trx
    .$extendTables<AuthTables & Times>()
    .deleteFrom('auth.verification')
    .where('identifier', '=', identify(token))
    .where((eb) => eb(eb.fn('starts_with', ['value', eb.val(PREFIX)]), '=', true))
    .where('expires_at', '>', (eb) => eb.fn<Date>('now'))
    .returning(['value', 'created_at'])
    .executeTakeFirst();
  const [, userId, tenantId, email] = VALUE.exec(spent?.value ?? '') ?? [];
  if (
    spent === undefined ||
    userId === undefined ||
    tenantId === undefined ||
    email === undefined
  ) {
    return undefined;
  }
  return { userId, tenantId: trustedTenantId(tenantId), email, issuedAt: spent.created_at };
}

/**
 * Whether the user was signed out everywhere, or their password or MFA
 * reset, changed or removed, at or after `since`. Run after an exclusive
 * lock on the user, so a revocation in progress has committed.
 */
export async function recoveredSince(
  trx: Transaction<unknown>,
  userId: string,
  since: Date,
): Promise<boolean> {
  const found = await trx
    .$extendTables<AuthTables & Times>()
    .selectFrom('auth.audit_event')
    .select('id')
    .where('user_id', '=', userId)
    .where('code', 'in', RECOVERIES)
    .where('occurred_at', '>=', since)
    .executeTakeFirst();
  return found !== undefined;
}
