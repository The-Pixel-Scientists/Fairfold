// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Team and invitation contracts: the `/platform/team` subpath of the domain
// package. Accepting an invitation is an auth route (`/auth`). Teams, the
// groups that restricted records name, and emergency access to those
// records are here too (ADR 0037).

import '../../jitless/index.ts';

export {
  breakGlassGrantSchema,
  breakGlassOpenSchema,
  breakGlassOutcomes,
  breakGlassQueueItemSchema,
  breakGlassReasons,
  breakGlassReasonTextSchema,
  breakGlassReviewItemSchema,
  breakGlassReviewSchema,
  breakGlassRoutes,
  listBreakGlassQueue,
  listOwnBreakGlass,
  openBreakGlass,
  readBreakGlassReview,
  reviewBreakGlass,
  type BreakGlassGrant,
  type BreakGlassOutcome,
  type BreakGlassReason,
} from './break-glass.ts';
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
export {
  addTeamMember,
  archiveTeam,
  createTeam,
  listTeams,
  readTeam,
  removeTeamMember,
  renameTeam,
  teamDetailSchema,
  teamListSchema,
  teamMemberSchema,
  teamNameBodySchema,
  teamNameSchema,
  teamsRoutes,
  teamSummarySchema,
  type TeamDetail,
  type TeamSummary,
} from './teams.ts';
