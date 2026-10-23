// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Inviting people to the team and revoking invitations. The auth module
// makes the token, sends the link and writes the audit event (ADR 0010); a
// handler only names who invites, from the session.

import type { inviteMember, revokeInvitation } from '@pixel-scientists/domain/platform/team';

import { revokeInvitation as revoke } from '../../auth/index.ts';
import type { MemberContext } from '../../context.ts';
import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';
import type { TeamAuth } from './index.ts';

const inviter = (context: MemberContext) =>
  ({ kind: 'user', membershipId: context.membership.id, requestId: context.requestId }) as const;

export const inviteMemberHandler =
  (auth: TeamAuth): Handler<typeof inviteMember> =>
  ({ tx, context, input }) =>
    auth.createInvitation(tx, inviter(context), input.body);

export const revokeInvitationHandler: Handler<typeof revokeInvitation> = async ({
  tx,
  context,
  input,
}) => {
  if (!(await revoke(tx, inviter(context), input.params.invitationId))) {
    throw new ApiError(404, undefined, { reason: 'not_found' });
  }
  return undefined;
};
