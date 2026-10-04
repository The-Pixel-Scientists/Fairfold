// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Team routes for tenant admins (ADR 0010): the members and pending
// invitations, and each change to them. Every change needs step-up. The
// invited person accepts through the auth route `acceptInvitation`.

import { z } from 'zod';

import { defineRoute } from '../../api/route.ts';
import { idSchema } from '../../id.ts';
import {
  invitationSchema,
  inviteSchema,
  memberSchema,
  rolesChangeSchema,
  teamSchema,
} from './schemas.ts';

const manage = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.members.manage',
  scope: 'tenant',
} as const;

const change = { ...manage, stepUp: true } as const;

const memberParams = z.strictObject({ membershipId: idSchema });

export const getTeam = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/team',
  summary: 'List the team members and pending invitations',
  responses: { 200: teamSchema },
});

export const inviteMember = defineRoute({
  ...change,
  method: 'POST',
  path: '/console/team/invitations',
  summary: 'Invite someone to the team by email, with their roles',
  body: inviteSchema,
  responses: { 201: invitationSchema },
});

export const revokeInvitation = defineRoute({
  ...change,
  method: 'DELETE',
  path: '/console/team/invitations/:invitationId',
  summary: 'Revoke a pending invitation',
  params: z.strictObject({ invitationId: idSchema }),
  responses: { 204: null },
});

export const changeMemberRoles = defineRoute({
  ...change,
  method: 'PUT',
  path: '/console/team/members/:membershipId/roles',
  summary: "Change a team member's roles",
  params: memberParams,
  body: rolesChangeSchema,
  responses: { 200: memberSchema },
});

export const suspendMember = defineRoute({
  ...change,
  method: 'POST',
  path: '/console/team/members/:membershipId/suspend',
  summary: 'Suspend a team member and sign them out',
  params: memberParams,
  responses: { 200: memberSchema },
});

export const reinstateMember = defineRoute({
  ...change,
  method: 'POST',
  path: '/console/team/members/:membershipId/reinstate',
  summary: 'Reinstate a suspended team member',
  params: memberParams,
  responses: { 200: memberSchema },
});

export const removeMember = defineRoute({
  ...change,
  method: 'DELETE',
  path: '/console/team/members/:membershipId',
  summary: 'Remove a team member and sign them out',
  params: memberParams,
  responses: { 204: null },
});

export const teamRoutes = {
  getTeam,
  inviteMember,
  revokeInvitation,
  changeMemberRoles,
  suspendMember,
  reinstateMember,
  removeMember,
} as const;
