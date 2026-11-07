// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Auth events (ADR 0010, "Audit"). recordAuthEvent() writes the event to
// auth.audit_event, as app_auth, in the transaction of the change it
// records, with a pending-copy row when a copy is due (copyIsDue()).
// After that transaction commits, copyAuthEvent() copies it to the tenant's
// own audit log as `platform.auth.<code>`, as app_api with the tenant of the
// acting or new session, if the user holds a membership there. The copy is
// keyed by the auth event's id, so a retry cannot duplicate it. A copy that
// fails, or an event with no session to take the tenant from (a failed
// sign-in), leaves its pending row for the replay command (audit-copy/),
// which writes the copy through the same writeAuthCopy(). The replay's own
// audit_copy_replayed event has no user: its copy names the operator.
//
// No password, token, code or cookie is ever a detail of an event.

import { withTenant, type Kysely, type TenantId, type Transaction } from '@pixel-scientists/db';
import type { AuthEventCode } from '@pixel-scientists/domain/auth';
import type { FastifyBaseLogger } from 'fastify';

import { recordAudit } from '../audit/writer.ts';
import type { AuthTables, TenantTables } from './tables.ts';

export interface AuthEventDetails {
  readonly requestId: string;
  readonly userId?: string;
  /** The tenant the event happened in: the acting session's, or the one a sign-in URL named. */
  readonly tenant?: string;
  /** A typed identifier, kept as ADR 0010's sign-in limits set out. */
  readonly identifier?: string;
  /** The client address Fastify derived through the trusted proxies. */
  readonly ip?: string;
  /** Why, as a code such as `bad_password`. */
  readonly reason?: string;
  /** For `audit_copy_replayed`, the auth event whose copy was written. */
  readonly replayedEventId?: string;
}

export interface AuthEvent extends AuthEventDetails {
  readonly id: string;
  readonly code: AuthEventCode;
}

/**
 * Whether an event is copied to its tenant's audit log: one with a tenant
 * and a user, or the replay's own event, which names the operator.
 */
export function copyIsDue(event: Pick<AuthEvent, 'code' | 'tenant' | 'userId'>): boolean {
  if (event.tenant === undefined) return false;
  return event.userId !== undefined || event.code === 'audit_copy_replayed';
}

/** Write an event in the change's transaction, which must be as app_auth. */
export async function recordAuthEvent(
  trx: Transaction<unknown>,
  code: AuthEventCode,
  details: AuthEventDetails,
): Promise<AuthEvent> {
  const db = trx.$extendTables<AuthTables>();
  const { id } = await db
    .insertInto('auth.audit_event')
    .values({
      request_id: details.requestId,
      code,
      reason: details.reason ?? null,
      user_id: details.userId ?? null,
      tenant_id: details.tenant ?? null,
      identifier: details.identifier ?? null,
      ip_address: details.ip ?? null,
      replayed_event_id: details.replayedEventId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (copyIsDue({ code, ...details })) {
    await db.insertInto('auth.audit_copy_pending').values({ auth_event_id: id }).execute();
  }
  return { ...details, id, code };
}

export interface CopyDependencies {
  /** As app_api. */
  readonly api: Kysely<unknown>;
  /** As app_auth. */
  readonly auth: Kysely<unknown>;
  readonly log: FastifyBaseLogger;
}

/** The unique index that keeps one copy of each auth event (migration 0003). */
function isDuplicateCopy(error: unknown): boolean {
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === '23505' && constraint === 'audit_event_auth_copy_once';
}

/** What writeAuthCopy() found: a copy written, one already there, or none due. */
export type CopyOutcome = 'copied' | 'exists' | 'none';

/**
 * Write a committed event's copy in `tenant`, as app_api, if `tenant` is the
 * event's and its user holds a membership there. The one copy function, for
 * the live path and the replay. Throws on any error but the duplicate.
 */
export async function writeAuthCopy(
  api: Kysely<unknown>,
  event: AuthEvent,
  tenant: TenantId,
): Promise<CopyOutcome> {
  const { userId } = event;
  if (event.tenant !== tenant) return 'none';
  try {
    if (event.code === 'audit_copy_replayed') return await writeReplayCopy(api, event, tenant);
    if (userId === undefined) return 'none';
    return await withTenant(api, tenant, async (tx) => {
      const member = await tx
        .$extendTables<TenantTables>()
        .selectFrom('app.membership')
        .select('id')
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (member === undefined) return 'none';
      await recordAudit(
        tx,
        { kind: 'user', membershipId: member.id, requestId: event.requestId },
        { action: `platform.auth.${event.code}`, entityId: event.id },
      );
      return 'copied';
    });
  } catch (error) {
    if (isDuplicateCopy(error)) return 'exists';
    throw error;
  }
}

/**
 * The copy of an audit_copy_replayed event: by the operator, keyed by its
 * own id as every copy is, with the replayed event's id as its change.
 */
async function writeReplayCopy(
  api: Kysely<unknown>,
  event: AuthEvent,
  tenant: TenantId,
): Promise<CopyOutcome> {
  const { replayedEventId } = event;
  if (replayedEventId === undefined) return 'none';
  await withTenant(api, tenant, (tx) =>
    recordAudit(
      tx,
      { kind: 'operator', requestId: event.requestId },
      {
        action: 'platform.auth.audit_copy_replayed',
        entityId: event.id,
        changes: { 'auth.audit_event.replayed_event_id': { after: replayedEventId } },
      },
    ),
  );
  return 'copied';
}

/**
 * Copy a committed event to its tenant's audit log, given the tenant of the
 * acting or new session, which must be the event's. Never throws.
 */
export async function copyAuthEvent(
  deps: CopyDependencies,
  event: AuthEvent,
  tenant: TenantId | undefined,
): Promise<void> {
  if (tenant === undefined || event.userId === undefined || event.tenant !== tenant) return;
  try {
    await writeAuthCopy(deps.api, event, tenant);
    await deps.auth
      .$extendTables<AuthTables>()
      .deleteFrom('auth.audit_copy_pending')
      .where('auth_event_id', '=', event.id)
      .execute();
  } catch (error) {
    deps.log.error(
      { err: error, authEventId: event.id, eventCode: event.code },
      'An auth event was not copied to its tenant audit log',
    );
  }
}
