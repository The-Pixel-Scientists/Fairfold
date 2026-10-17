// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading, issuing and revoking sessions (ADR 0010, "Sessions"). A request's
// session comes only from the resolved app's cookie: its token's hash goes
// to auth.session_context(), as app_api, and nothing else is believed. A new
// state (sign-in, MFA completion, step-up, tenant switch) is always a new
// session with a new token, and the one it replaces is revoked in the same
// transaction, so the session id changes. A replacement locks the old
// session first, so two requests cannot both replace it.
//
// Every transaction that issues a session locks the user's row first, shared,
// and revoking all of a user's sessions locks it exclusively (ADR 0010). So a
// session is either committed before a revocation reads the sessions, and
// revoked by it, or issued after the revocation commits, by a transaction
// that then sees its changes, such as a new password.

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
  /** Re-authenticated now (true), at this time, or not yet (false). */
  readonly reauthenticated: boolean | Date;
  /** When it ends at the latest: by default the app's absolute timeout from now. */
  readonly expiresAt?: Date;
  readonly ip: string;
  readonly userAgent?: string;
  /** The hash of the session this one replaces, which is revoked. */
  readonly replaces?: Buffer;
}

/**
 * How a transaction locks a user's row: 'share' to issue sessions, 'update'
 * to revoke them all, and 'no key update' to issue sessions and also update
 * the row, so two such transactions take turns rather than deadlock.
 */
export type UserLock = 'share' | 'no key update' | 'update';

/** Lock the user's row until `trx` ends, as app_auth, and say whether the user is active. */
export async function lockUser(
  trx: Transaction<unknown>,
  userId: string,
  mode: UserLock,
): Promise<boolean> {
  const query = trx
    .$extendTables<AuthTables>()
    .selectFrom('auth.user')
    .select('status')
    .where('id', '=', userId);
  const locked =
    mode === 'share'
      ? query.forShare()
      : mode === 'update'
        ? query.forUpdate()
        : query.forNoKeyUpdate();
  return (await locked.executeTakeFirst())?.status === 'active';
}

/** The user's password hash as it is now, in `trx`, if they have one. Read after lockUser(). */
export async function currentPassword(
  trx: Transaction<unknown>,
  userId: string,
): Promise<string | undefined> {
  const account = await trx
    .$extendTables<AuthTables>()
    .selectFrom('auth.account')
    .select('password')
    .where('user_id', '=', userId)
    .where('provider_id', '=', 'credential')
    .executeTakeFirst();
  return account?.password;
}

/**
 * Issue a session in `trx`, as app_auth, and return its token for the
 * cookie. The token itself is never stored. The caller locks the user first
 * (lockUser or lockSession); taking it here as well makes sure of it.
 */
export async function issueSession(trx: Transaction<unknown>, next: NewSession): Promise<string> {
  if (!(await lockUser(trx, next.userId, 'share'))) {
    throw new Error('A session cannot be issued to a user who is not active.');
  }
  if (next.replaces !== undefined) await revoke(trx, next.replaces);
  const token = newToken();
  const { reauthenticated } = next;
  await trx
    .$extendTables<AuthTables>()
    .insertInto('auth.session')
    .values((eb) => ({
      user_id: next.userId,
      token_hash: hashToken(token),
      app: next.app,
      active_tenant_id: next.tenantId,
      mfa_state: next.mfa,
      expires_at: next.expiresAt ?? new Date(Date.now() + ABSOLUTE_MS[next.app]),
      reauthenticated_at: reauthenticated === true ? eb.fn<Date>('now') : reauthenticated || null,
      ip_address: next.ip,
      user_agent: next.userAgent?.slice(0, 1024) ?? null,
    }))
    .execute();
  return token;
}

export type StoredSession = Pick<
  AuthTables['auth.session'],
  'user_id' | 'app' | 'active_tenant_id' | 'mfa_state' | 'expires_at' | 'reauthenticated_at'
> & {
  readonly mfa_failures: number;
  readonly token_hash: Buffer;
  /** The address it was issued to, as plainAddress() gave it. */
  readonly ip_address: string;
};

/**
 * The unrevoked session of the active user `userId` whose token hashes to
 * `tokenHash`, locked until `trx` ends, after the user (lockUser) with `mode`.
 */
export async function lockSession(
  trx: Transaction<unknown>,
  userId: string,
  tokenHash: Buffer,
  mode: Exclude<UserLock, 'update'> = 'share',
): Promise<StoredSession | undefined> {
  if (!(await lockUser(trx, userId, mode))) return undefined;
  return trx
    .$extendTables<AuthTables>()
    .selectFrom('auth.session')
    .select((eb) => [
      'token_hash',
      'user_id',
      'app',
      'active_tenant_id',
      'mfa_state',
      'mfa_failures',
      'expires_at',
      'reauthenticated_at',
      eb.fn<string>('host', ['ip_address']).as('ip_address'),
    ])
    .where('token_hash', '=', tokenHash)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
}

/**
 * Replace a locked session with a new one, with a new id and token, in
 * `trx`. Only `change` differs: its user, app and absolute end carry over,
 * so a new state never extends a session, and so does its last
 * re-authentication unless `change` says it is now.
 */
export function rotateSession(
  trx: Transaction<unknown>,
  current: StoredSession,
  change: {
    readonly mfa?: MfaState;
    readonly tenantId?: string;
    readonly reauthenticated?: true;
    readonly ip: string;
    readonly userAgent?: string | undefined;
  },
): Promise<string> {
  const tenantId = change.tenantId ?? current.active_tenant_id;
  if (tenantId === null) throw new Error('A session with no active tenant cannot be replaced.');
  return issueSession(trx, {
    userId: current.user_id,
    app: current.app,
    tenantId,
    mfa: change.mfa ?? current.mfa_state,
    reauthenticated: change.reauthenticated ?? current.reauthenticated_at ?? false,
    expiresAt: current.expires_at,
    ip: change.ip,
    ...(change.userAgent === undefined ? {} : { userAgent: change.userAgent }),
    replaces: current.token_hash,
  });
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

/**
 * Revoke every live session of a user, or those active in one tenant, in
 * `trx`, as app_auth. It locks the user first, so no session is being issued
 * meanwhile.
 */
export async function revokeAll(
  trx: Transaction<unknown>,
  target: { readonly userId: string; readonly tenantId?: string },
): Promise<number> {
  await lockUser(trx, target.userId, 'update');
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
