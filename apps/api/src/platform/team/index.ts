// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The team routes for tenant admins (S02-14), matched with their contracts:
// the members and pending invitations, and each change to them. The policy
// has already checked `platform.members.manage` and step-up before a handler
// runs.

import {
  changeMemberRoles,
  getTeam,
  inviteMember,
  reinstateMember,
  removeMember,
  revokeInvitation,
  suspendMember,
} from '@pixel-scientists/domain/platform/team';

import type { Auth } from '../../auth/index.ts';
import { route, type Handler, type Route } from '../../routes/register.ts';
import { inviteMemberHandler, revokeInvitationHandler } from './invitations.ts';
import {
  changeMemberRolesHandler,
  reinstateMemberHandler,
  removeMemberHandler,
  suspendMemberHandler,
} from './members.ts';
import { pendingInvitations, teamMemberships, toMembers } from './read.ts';

/** What the team routes need of the auth module. */
export type TeamAuth = Pick<Auth, 'createInvitation' | 'revokeSessionsForMembership'>;

const getTeamHandler: Handler<typeof getTeam> = async ({ tx }) => ({
  members: await toMembers(tx, await teamMemberships(tx, { lock: false })),
  invitations: await pendingInvitations(tx),
});

export function teamRoutes(auth: TeamAuth): readonly Route[] {
  return [
    route(getTeam, getTeamHandler),
    route(inviteMember, inviteMemberHandler(auth)),
    route(revokeInvitation, revokeInvitationHandler),
    route(changeMemberRoles, changeMemberRolesHandler(auth)),
    route(suspendMember, suspendMemberHandler(auth)),
    route(reinstateMember, reinstateMemberHandler(auth)),
    route(removeMember, removeMemberHandler(auth)),
  ];
}
