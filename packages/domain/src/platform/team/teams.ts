// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Teams (ADR 0037): groups of members that a restricted record's access rows
// can name, so the record reaches each of them. A team gives reach only,
// never a permission or a role, and code never checks its name. Members are
// shown by membership id and name, never email. Every change needs step-up.

import { z } from 'zod';

import { defineRoute } from '../../api/route.ts';
import { idSchema } from '../../id.ts';
import { messages } from '../messages.ts';
import { memberStatuses } from './schemas.ts';

/** One line of 1 to 100 characters, with a letter or number and no hidden characters. */
export const teamNameSchema = z
  .string()
  .trim()
  .min(1, { error: messages.enterTeamName })
  .max(100, { error: messages.teamNameTooLong })
  .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]*$/u, { error: messages.tenantNameHidden })
  .refine((name) => /[\p{L}\p{N}]/u.test(name), { error: messages.tenantNameVisible });

/** Creating or renaming a team. */
export const teamNameBodySchema = z.strictObject({ name: teamNameSchema });

export const teamSummarySchema = z.strictObject({
  id: idSchema,
  name: z.string(),
  memberCount: z.int().min(0),
  /** An archived team gives no reach; its access rows stay as history. */
  archivedAt: z.iso.datetime().nullable(),
});

export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const teamMemberSchema = z.strictObject({
  membershipId: idSchema,
  /** From the member's person record; null when it has no name yet. */
  name: z.string().nullable(),
  /** A suspended member has no reach while suspended. */
  status: z.enum(memberStatuses),
});

export const teamDetailSchema = teamSummarySchema.extend({ members: z.array(teamMemberSchema) });

export type TeamDetail = z.infer<typeof teamDetailSchema>;

export const teamListSchema = z.strictObject({ teams: z.array(teamSummarySchema) });

const manage = {
  audience: 'console',
  module: 'platform',
  permission: 'platform.teams.manage',
  scope: 'tenant',
} as const;

const change = { ...manage, stepUp: true } as const;

const teamParams = z.strictObject({ teamId: idSchema });

const teamMemberParams = z.strictObject({ teamId: idSchema, membershipId: idSchema });

export const listTeams = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/teams',
  summary: 'List the teams, including archived ones',
  responses: { 200: teamListSchema },
});

export const readTeam = defineRoute({
  ...manage,
  method: 'GET',
  path: '/console/teams/:teamId',
  summary: 'Read a team with its members',
  params: teamParams,
  responses: { 200: teamDetailSchema },
});

export const createTeam = defineRoute({
  ...change,
  method: 'POST',
  idempotent: true,
  path: '/console/teams',
  summary: 'Create a team',
  body: teamNameBodySchema,
  responses: { 201: teamSummarySchema },
});

export const renameTeam = defineRoute({
  ...change,
  method: 'PATCH',
  path: '/console/teams/:teamId',
  summary: 'Rename a team',
  params: teamParams,
  body: teamNameBodySchema,
  responses: { 200: teamSummarySchema },
});

export const archiveTeam = defineRoute({
  ...change,
  method: 'POST',
  path: '/console/teams/:teamId/archive',
  summary: 'Archive a team, so it no longer gives its members reach',
  params: teamParams,
  responses: { 200: teamSummarySchema },
});

export const addTeamMember = defineRoute({
  ...change,
  method: 'PUT',
  path: '/console/teams/:teamId/members/:membershipId',
  summary: 'Add a member to a team',
  params: teamMemberParams,
  responses: { 204: null },
});

export const removeTeamMember = defineRoute({
  ...change,
  method: 'DELETE',
  path: '/console/teams/:teamId/members/:membershipId',
  summary: 'Remove a member from a team',
  params: teamMemberParams,
  responses: { 204: null },
});

export const teamsRoutes = {
  listTeams,
  readTeam,
  createTeam,
  renameTeam,
  archiveTeam,
  addTeamMember,
  removeTeamMember,
} as const;
