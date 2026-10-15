// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Auth events (ADR 0010, "Audit"). recordAuthEvent() writes the event to
// auth.audit_event, as app_auth, in the transaction of the change it
// records, with a pending-copy row when the event has a user and a tenant.
// After that transaction commits, copyAuthEvent() copies it to the tenant's
// own audit log as `platform.auth.<code>`, as app_api with the tenant of the
// acting or new session, if the user holds a membership there. The copy is
// keyed by the auth event's id, so a retry cannot duplicate it. A copy that
// fails leaves its pending row for the replay command (deferred, D2).
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
  /** The tenant of the acting or new session, whose audit log gets a copy. */
  readonly tenant?: TenantId;
  /** A typed identifier, kept as ADR 0010's sign-in limits set out. */
  readonly identifier?: string;
  /** The client address Fastify derived through the trusted proxies. */
  readonly ip?: string;
  /** Why, as a code such as `bad_password`. */
  readonly reason?: string;
}

export interface AuthEvent extends AuthEventDetails {
  readonly id: string;
  readonly code: AuthEventCode;
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
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (details.userId !== undefined && details.tenant !== undefined) {
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

/** Copy a committed event to its tenant's audit log. Never throws. */
export async function copyAuthEvent(deps: CopyDependencies, event: AuthEvent): Promise<void> {
  const { tenant, userId } = event;
  if (tenant === undefined || userId === undefined) return;
  try {
    try {
      await withTenant(deps.api, tenant, async (tx) => {
        const member = await tx
          .$extendTables<TenantTables>()
          .selectFrom('app.membership')
          .select('id')
          .where('user_id', '=', userId)
          .executeTakeFirst();
        if (member === undefined) return;
        await recordAudit(
          tx,
          { kind: 'user', membershipId: member.id, requestId: event.requestId },
          { action: `platform.auth.${event.code}`, entityId: event.id },
        );
      });
    } catch (error) {
      if (!isDuplicateCopy(error)) throw error;
    }
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
