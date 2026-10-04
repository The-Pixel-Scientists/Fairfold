// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Team and invitation contracts: the `/platform/team` subpath of the domain
// package. Accepting an invitation is an auth route (`/auth`).

import '../../jitless/index.ts';

export {
  changeMemberRoles,
  getTeam,
  inviteMember,
  reinstateMember,
  removeMember,
  revokeInvitation,
  suspendMember,
  teamRoutes,
} from './routes.ts';
export {
  consoleRoleSchema,
  invitationSchema,
  inviteSchema,
  memberSchema,
  memberStatuses,
  rolesChangeSchema,
  teamRolesSchema,
  teamSchema,
  type Invitation,
  type Member,
  type Team,
} from './schemas.ts';
