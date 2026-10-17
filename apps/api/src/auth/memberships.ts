// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Ending a member's sessions in their tenant when an admin suspends or
// removes them or changes their roles (ADR 0010). It runs inside the
// change's tenant transaction, as app_api, which names the member. Their
// sessions active in this tenant are revoked, as app_auth, and the event
// recorded, before that transaction commits: if it then fails, the member
// only has to sign in again. Their sessions in other tenants stay. Every
// request checks its membership as well, so a session issued meanwhile gets
// nothing from one that is no longer active.

import type { TenantId, Transaction } from '@pixel-scientists/db';

import { copyAuthEvent, recordAuthEvent, type CopyDependencies } from './events.ts';
import { revokeAll } from './sessions.ts';
import type { TenantTables } from './tables.ts';

export interface MembershipChange {
  readonly membershipId: string;
  /** The tenant of the change, from the admin's session: the transaction's. */
  readonly tenant: TenantId;
  readonly requestId: string;
  readonly reason: 'membership_suspended' | 'membership_removed' | 'roles_changed';
}

/** Revoke the member's sessions active in their tenant, and say how many. */
export async function revokeSessionsForMembership(
  deps: CopyDependencies,
  trx: Transaction<unknown>,
  change: MembershipChange,
): Promise<number> {
  const { membershipId, tenant, requestId, reason } = change;
  const member = await trx
    .$extendTables<TenantTables>()
    .selectFrom('app.membership')
    .select(['user_id', 'tenant_id'])
    .where('id', '=', membershipId)
    .executeTakeFirst();
  if (member?.tenant_id !== tenant) throw new Error('The membership is not in this tenant.');
  const userId = member.user_id;

  const { count, event } = await deps.auth.transaction().execute(async (auth) => ({
    count: await revokeAll(auth, { userId, tenantId: tenant }),
    event: await recordAuthEvent(auth, 'sessions_revoked', { requestId, userId, tenant, reason }),
  }));
  await copyAuthEvent(deps, event, tenant);
  return count;
}
