// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Invitations to a tenant's team (ADR 0010, ADR 0019), in the caller's
// tenant transaction. A token is 256 random bits, kept only as its SHA-256
// hash and sent once, in the URL fragment of an emailed link to the
// tenant's console invitation page. The database sets the expiry, 7 days
// on. The email goes before the transaction commits, so an invitation that
// cannot be sent is not kept.
//
// A member invites as app_api, and an address whose account is already in
// the team, or that has a live invitation, is refused; an expired one is
// revoked first. The operator invites a new tenant's first admin as
// app_worker, which may only add the row: that tenant has no members or
// invitations yet, so nothing is read, and the command gives the slug and
// name it has just created the tenant with. Accepting (invitation-accept.ts)
// checks the membership again either way.

import { randomUUID } from 'node:crypto';

import type { Transaction } from '@pixel-scientists/db';
import { productName } from '@pixel-scientists/domain/platform';
import { inviteSchema, type Invitation } from '@pixel-scientists/domain/platform/team';

import { recordAudit } from '../audit/writer.ts';
import type { Sender } from '../email/sender.ts';
import { ApiError } from '../problems.ts';
import { hashToken, newToken } from './cookies.ts';
import type { TenantTables } from './tables.ts';

export interface InvitationDependencies {
  /** The console's origin and any path prefix, before a tenant's slug. */
  readonly consoleBase: string;
  readonly sender: Sender | undefined;
  /** The id of the account with this address, if any, as app_auth. A member's invitation needs it. */
  readonly accountId?: (email: string) => Promise<string | undefined>;
}

/** Who invites: a member of the tenant, from the session, or the operator command. */
export type Inviter =
  | { readonly kind: 'user'; readonly membershipId: string; readonly requestId: string }
  | {
      readonly kind: 'operator';
      readonly requestId: string;
      /** The tenant the command has just created. */
      readonly tenant: { readonly slug: string; readonly name: string };
    };

type Member = Extract<Inviter, { kind: 'user' }>;

/** How long an invitation lasts: the default of app.invitation.expires_at. */
const LIFETIME_MS = 168 * 3600_000;

const tables = (trx: Transaction<unknown>) => trx.$extendTables<TenantTables>();

/** Invite `email` to the transaction's tenant with `roles`, and email the link. */
export async function createInvitation(
  deps: InvitationDependencies,
  trx: Transaction<unknown>,
  actor: Inviter,
  input: { readonly email: string; readonly roles: readonly string[] },
): Promise<Invitation> {
  const { email, roles } = inviteSchema.parse(input);
  const db = tables(trx);
  const tenant =
    actor.kind === 'operator'
      ? actor.tenant
      : await db.selectFrom('app.tenant').select(['slug', 'name']).executeTakeFirstOrThrow();
  const inviter = actor.kind === 'user' ? actor.membershipId : null;
  if (actor.kind === 'user') {
    if (deps.accountId === undefined) throw new Error('A member invites with an account lookup.');
    const userId = await deps.accountId(email);
    const member =
      userId !== undefined &&
      (await db
        .selectFrom('app.membership')
        .select('id')
        .where('user_id', '=', userId)
        .where('status', '<>', 'removed')
        .executeTakeFirst());
    if (member)
      throw new ApiError(409, 'This person is already in the team.', { reason: 'member' });
    await revoke(trx, actor, { expiredTo: email });
  }

  const id = randomUUID();
  const token = newToken();
  try {
    await db
      .insertInto('app.invitation')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        id,
        email,
        roles,
        token_hash: hashToken(token),
        ...(inviter === null ? {} : { created_by: inviter, updated_by: inviter }),
      }))
      .execute();
  } catch (error) {
    const { code, constraint } = error as { code?: unknown; constraint?: unknown };
    if (code !== '23505' || constraint !== 'invitation_one_pending') throw error;
    throw new ApiError(
      409,
      'This person already has an invitation waiting. Revoke it to invite them again.',
      { reason: 'pending' },
    );
  }
  // As the row's default sets it: now() is fixed for the transaction.
  const { now } = await trx
    .selectNoFrom((eb) => eb.fn<Date>('now').as('now'))
    .executeTakeFirstOrThrow();
  const expiresAt = new Date(now.getTime() + LIFETIME_MS);
  await recordAudit(trx, actor, {
    action: 'platform.invitation.sent',
    entityId: id,
    changes: { 'app.invitation.email': {}, 'app.invitation.roles': { after: roles } },
  });

  const sent = await deps.sender?.send({
    to: email,
    subject: `Join ${tenant.name} on ${productName}`,
    text: [
      `You are invited to join the ${tenant.name} team on ${productName}.`,
      'To accept, open this link within 7 days:',
      `${deps.consoleBase}/${tenant.slug}/invitation#token=${token}`,
      'You will need to sign in, or create an account with this email address, first. If you did not expect this invitation, ignore this email.',
    ].join('\n\n'),
    requestId: actor.requestId,
  });
  if (sent?.sent !== true) {
    throw new ApiError(503, 'The invitation could not be sent. Try again in a few minutes.', {
      reason: sent === undefined ? 'no_sender' : sent.code,
    });
  }
  return { id, email, roles, expiresAt: expiresAt.toISOString() };
}

/** Revoke a pending invitation of the transaction's tenant. False if there is none with this id. */
export async function revokeInvitation(
  trx: Transaction<unknown>,
  actor: Member,
  invitationId: string,
): Promise<boolean> {
  return (await revoke(trx, actor, { id: invitationId })) > 0;
}

/** Revoke the pending invitation with this id, or those to this address that have expired. */
async function revoke(
  trx: Transaction<unknown>,
  actor: Member,
  which: { readonly id: string } | { readonly expiredTo: string },
): Promise<number> {
  const revoked = await tables(trx)
    .updateTable('app.invitation')
    .set({ status: 'revoked', updated_by: actor.membershipId })
    .where('status', '=', 'pending')
    .where((eb) =>
      'id' in which
        ? eb('id', '=', which.id)
        : eb.and([eb('email', '=', which.expiredTo), eb('expires_at', '<=', eb.fn<Date>('now'))]),
    )
    .returning('id')
    .execute();
  for (const { id } of revoked) {
    await recordAudit(trx, actor, {
      action: 'platform.invitation.revoked',
      entityId: id,
      changes: { 'app.invitation.status': { before: 'pending', after: 'revoked' } },
    });
  }
  return revoked.length;
}
