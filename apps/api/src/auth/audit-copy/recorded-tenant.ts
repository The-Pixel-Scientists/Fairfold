// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The replay helper (ADR 0003, tenant source 5): an auth event's copy is
// written in the tenant recorded on that event, read here as app_auth, and
// in no other. Only apps/api/src/auth may import this file
// (boundary.test.ts, until the Semgrep rule lands).

import type { Kysely } from '@pixel-scientists/db';

import { trustedTenantId } from '../../../../../packages/db/src/tenant-context.ts';
import { writeAuthCopy, type AuthEvent, type CopyOutcome } from '../events.ts';
import type { AuthTables } from '../tables.ts';

/** Read an auth event as app_auth, with only what its copy needs. */
export async function readRecordedEvent(auth: Kysely<unknown>, id: string): Promise<AuthEvent> {
  const row = await auth
    .$extendTables<AuthTables>()
    .selectFrom('auth.audit_event')
    .select(['id', 'code', 'request_id', 'user_id', 'tenant_id', 'replayed_event_id'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return {
    id: row.id,
    code: row.code,
    requestId: row.request_id,
    ...(row.user_id === null ? {} : { userId: row.user_id }),
    ...(row.tenant_id === null ? {} : { tenant: row.tenant_id }),
    ...(row.replayed_event_id === null ? {} : { replayedEventId: row.replayed_event_id }),
  };
}

/** Write the copy of auth event `id`, as app_api, in the tenant recorded on it. */
export async function copyInRecordedTenant(
  deps: { readonly api: Kysely<unknown>; readonly auth: Kysely<unknown> },
  id: string,
): Promise<{ readonly event: AuthEvent; readonly outcome: CopyOutcome }> {
  const event = await readRecordedEvent(deps.auth, id);
  return { event, outcome: await writeInRecordedTenant(deps.api, event) };
}

/** Write the copy of a committed `event`, as app_api, in the tenant recorded on it. */
export function writeInRecordedTenant(
  api: Kysely<unknown>,
  event: AuthEvent,
): Promise<CopyOutcome> {
  return event.tenant === undefined
    ? Promise.resolve('none')
    : writeAuthCopy(api, event, trustedTenantId(event.tenant));
}
