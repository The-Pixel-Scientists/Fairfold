// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Accepting an invitation (ADR 0010). Only a complete console session gets
// this far, and its active tenant, the one it signed in at, is the only one
// whose invitations it can see. The token must be pending, unexpired and for
// the session's own address; any other token gets the same 404.
//
// One tenant transaction, as app_api, locks the invitation, then makes the
// membership with the invited roles, or reinstates a removed one; an active
// or suspended membership is refused. It marks the invitation accepted,
// finds or makes the person through party, and records the events. Inside
// it, as app_auth, the session is replaced by one with a new id and the auth
// event recorded; that commits first, so a session that has gone undoes the
// acceptance. Of two acceptances at once, the second waits for the lock and
// then finds the invitation no longer pending.

import { withTenant, type Transaction } from '@pixel-scientists/db';
import { acceptInvitation } from '@pixel-scientists/domain/auth';
import { ensurePersonForUser } from '@pixel-scientists/party/server';

import { recordAudit } from '../audit/writer.ts';
import { ApiError } from '../problems.ts';
import { route, type Route } from '../routes/register.ts';
import { hashToken } from './cookies.ts';
import { copyAuthEvent, recordAuthEvent } from './events.ts';
import { plainAddress } from './limits.ts';
import { answerWithSession, sessionOf, type RouteDependencies } from './routes.ts';
import { detailsOf, lockSession, rotateSession } from './sessions.ts';
import type { TenantTables } from './tables.ts';

const notFound = () => new ApiError(404, undefined, { reason: 'not_found' });

/**
 * Give the user a membership with `roles`, made by the inviter: a new one,
 * or their removed one reinstated. Its id and whether it is new; none if
 * they hold an active or suspended one.
 */
async function joinTeam(
  trx: Transaction<unknown>,
  userId: string,
  invitation: { readonly roles: string[]; readonly created_by: string | null },
): Promise<{ id: string; created: boolean } | undefined> {
  const db = trx.$extendTables<TenantTables>();
  const by = { roles: invitation.roles, updated_by: invitation.created_by };
  const current = await db
    .selectFrom('app.membership')
    .select(['id', 'status'])
    .where('user_id', '=', userId)
    .forUpdate()
    .executeTakeFirst();
  if (current === undefined) {
    const made = await db
      .insertInto('app.membership')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        user_id: userId,
        created_by: invitation.created_by,
        ...by,
      }))
      .onConflict((conflict) => conflict.columns(['tenant_id', 'user_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return made && { id: made.id, created: true };
  }
  if (current.status !== 'removed') return undefined;
  await db
    .updateTable('app.membership')
    .set({ ...by, status: 'active' })
    .where('id', '=', current.id)
    .execute();
  return { id: current.id, created: false };
}

export function invitationRoutes(deps: RouteDependencies): Route[] {
  return [
    route(acceptInvitation, async ({ context, input }) => {
      const session = sessionOf(context);
      if (session.app !== 'console' || session.mfa !== 'complete') throw notFound();
      const { requestId } = context;
      const { userId, tenant } = session;
      const email = await session.email();
      const { tokenHash } = detailsOf(session);
      const { ip: address, userAgent } = deps.client(requestId);
      const ip = plainAddress(address);

      const accepted = await withTenant(deps.api, tenant, async (tx) => {
        const db = tx.$extendTables<TenantTables>();
        const invitation = await db
          .selectFrom('app.invitation')
          .select(['id', 'roles', 'created_by'])
          .where('token_hash', '=', hashToken(input.body.token))
          .where('status', '=', 'pending')
          .where('email', '=', email)
          .where((eb) => eb('expires_at', '>', eb.fn<Date>('now')))
          .forUpdate()
          .executeTakeFirst();
        if (invitation === undefined) throw notFound();
        const membership = await joinTeam(tx, userId, invitation);
        if (membership === undefined) throw notFound();
        await db
          .updateTable('app.invitation')
          .set({
            status: 'accepted',
            accepted_membership_id: membership.id,
            updated_by: membership.id,
          })
          .where('id', '=', invitation.id)
          .execute();

        const actor = { kind: 'user', membershipId: membership.id, requestId } as const;
        await recordAudit(tx, actor, {
          action: membership.created
            ? 'platform.membership.created'
            : 'platform.membership.reinstated',
          entityId: membership.id,
          changes: { 'app.membership.roles': { after: invitation.roles } },
        });
        const person = await ensurePersonForUser(tx, { userId, email });
        if (person.created) {
          await recordAudit(tx, actor, {
            action: 'party.person.created',
            entityId: person.personId,
            changes: { 'party.person.email': {}, 'party.person.user_id': {} },
          });
        }

        return deps.auth.transaction().execute(async (trx) => {
          const current = await lockSession(trx, userId, tokenHash);
          if (current === undefined) throw new ApiError(401, undefined, { reason: 'no_session' });
          return {
            token: await rotateSession(trx, current, { ip, userAgent }),
            event: await recordAuthEvent(trx, 'invitation_accepted', {
              requestId,
              userId,
              tenant,
              ip,
            }),
          };
        });
      });

      await copyAuthEvent(deps, accepted.event, tenant);
      return (await answerWithSession(deps, requestId, accepted.token, email)).body;
    }),
  ];
}
