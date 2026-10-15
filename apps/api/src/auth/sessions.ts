// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading, issuing and revoking sessions (ADR 0010, "Sessions"). A request's
// session comes only from the resolved app's cookie: its token's hash goes
// to auth.session_context(), as app_api, and nothing else is believed. A new
// state (sign-in, MFA completion, tenant switch) is always a new session
// with a new token, and the one it replaces is revoked in the same
// transaction, so the session id changes.

import { sessionContext, touchSession, type Kysely, type Transaction } from '@pixel-scientists/db';
import type { App } from '@pixel-scientists/domain/platform';
import type { FastifyRequest } from 'fastify';

import type { MfaState, RequestSession, SessionRead } from '../context.ts';
import { hashToken, newToken, readToken } from './cookies.ts';
import type { AuthTables } from './tables.ts';

/** What readSession() learnt beyond the context, for the auth routes. */
export interface SessionDetails {
  readonly tokenHash: Buffer;
  readonly expiresAt: Date;
  readonly reauthenticatedAt: Date | null;
  readonly ip: string;
}

const details = new WeakMap<RequestSession, SessionDetails>();

/** The details of a session that readSession() returned. */
export function detailsOf(session: RequestSession): SessionDetails {
  const found = details.get(session);
  if (found === undefined) throw new Error('This session was not read by the auth module.');
  return found;
}

export interface SessionDependencies {
  /** As app_api, for auth.session_context(). */
  readonly api: Kysely<unknown>;
  /** As app_auth, for last seen and the email address. */
  readonly auth: Kysely<unknown>;
  readonly resolveApp: (request: FastifyRequest) => App | null;
}

/** Reads a request's app and its live session, if any. */
export function sessionReader(deps: SessionDependencies) {
  const users = deps.auth.$extendTables<AuthTables>();
  return async (request: FastifyRequest): Promise<SessionRead> => {
    const app = deps.resolveApp(request);
    if (app === null) return { app, session: null };
    const token = readToken(request.headers.cookie, app);
    if (token === undefined) return { app, session: null };
    const tokenHash = hashToken(token);
    const row = await sessionContext(deps.api, tokenHash);
    if (row === undefined || row.app !== app) return { app, session: null };
    await touchSession(deps.auth, tokenHash);

    let email: Promise<string> | undefined;
    const session: RequestSession = {
      userId: row.userId,
      app,
      tenant: row.tenant,
      mfa: row.mfaState,
      recentAuthAt: row.reauthenticatedAt,
      email: () =>
        (email ??= users
          .selectFrom('auth.user')
          .select('email')
          .where('id', '=', row.userId)
          .executeTakeFirstOrThrow()
          .then((user) => user.email)),
    };
    details.set(session, {
      tokenHash,
      expiresAt: row.expiresAt,
      reauthenticatedAt: row.reauthenticatedAt,
      ip: request.ip,
    });
    return { app, session };
  };
}

/** How long a session may last at most, by app (ADR 0010). */
const ABSOLUTE_MS: Readonly<Record<App, number>> = {
  console: 12 * 3600_000,
  portal: 24 * 3600_000,
};

export interface NewSession {
  readonly userId: string;
  readonly app: App;
  readonly tenantId: string;
  readonly mfa: MfaState;
  readonly reauthenticated: boolean;
  readonly ip: string;
  readonly userAgent?: string;
  /** The hash of the session this one replaces, which is revoked. */
  readonly replaces?: Buffer;
}

/**
 * Issue a session in `trx`, as app_auth, and return its token for the
 * cookie. The token itself is never stored.
 */
export async function issueSession(trx: Transaction<unknown>, next: NewSession): Promise<string> {
  const db = trx.$extendTables<{
    'auth.session': AuthTables['auth.session'] & {
      app: App;
      mfa_state: MfaState;
      expires_at: Date;
      reauthenticated_at: Date | null;
      ip_address: string;
      user_agent: string | null;
    };
  }>();
  if (next.replaces !== undefined) await revoke(trx, next.replaces);
  const token = newToken();
  await db
    .insertInto('auth.session')
    .values((eb) => ({
      user_id: next.userId,
      token_hash: hashToken(token),
      app: next.app,
      active_tenant_id: next.tenantId,
      mfa_state: next.mfa,
      expires_at: new Date(Date.now() + ABSOLUTE_MS[next.app]),
      reauthenticated_at: next.reauthenticated ? eb.fn<Date>('now') : null,
      ip_address: next.ip,
      user_agent: next.userAgent?.slice(0, 1024) ?? null,
    }))
    .execute();
  return token;
}

/** Revoke the session whose token hashes to `tokenHash`, in `trx`, as app_auth. */
export async function revoke(trx: Transaction<unknown>, tokenHash: Buffer): Promise<void> {
  await trx
    .$extendTables<AuthTables>()
    .updateTable('auth.session')
    .set((eb) => ({ revoked_at: eb.fn<Date>('now') }))
    .where('token_hash', '=', tokenHash)
    .where('revoked_at', 'is', null)
    .execute();
}

/** Revoke every live session of a user, or those active in one tenant, in `trx`, as app_auth. */
export async function revokeAll(
  trx: Transaction<unknown>,
  target: { readonly userId: string; readonly tenantId?: string },
): Promise<number> {
  let query = trx
    .$extendTables<AuthTables>()
    .updateTable('auth.session')
    .set((eb) => ({ revoked_at: eb.fn<Date>('now') }))
    .where('user_id', '=', target.userId)
    .where('revoked_at', 'is', null);
  if (target.tenantId !== undefined) query = query.where('active_tenant_id', '=', target.tenantId);
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows);
}
