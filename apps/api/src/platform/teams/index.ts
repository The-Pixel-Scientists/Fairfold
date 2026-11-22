// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The teams routes (ADR 0037), matched with their contracts: teams are groups
// of members that a restricted record's access rows can name, and give reach
// only. Separate from the members and invitations in ../team. The policy has
// already checked `platform.teams.manage` and, for a change, step-up.

import {
  addTeamMember,
  archiveTeam,
  createTeam,
  listTeams,
  readTeam,
  removeTeamMember,
  renameTeam,
} from '@pixel-scientists/domain/platform/team';

import { ApiError } from '../../problems.ts';
import { route, type Handler, type Route } from '../../routes/register.ts';
import {
  addTeamMemberHandler,
  archiveTeamHandler,
  createTeamHandler,
  removeTeamMemberHandler,
  renameTeamHandler,
} from './handlers.ts';
import { listTeamSummaries, readTeamDetail, readTeamSummary } from './read.ts';

const notFound = () => new ApiError(404, undefined, { reason: 'not_found' });

const listTeamsHandler: Handler<typeof listTeams> = async ({ tx }) => ({
  teams: await listTeamSummaries(tx),
});

const readTeamHandler: Handler<typeof readTeam> = async ({ tx, input }) =>
  (await readTeamDetail(tx, input.params.teamId)) ?? Promise.reject(notFound());

export const teamsRoutes = (): readonly Route[] => [
  route(listTeams, listTeamsHandler),
  route(readTeam, readTeamHandler),
  route(createTeam, createTeamHandler, {
    replay: async ({ tx, id }) =>
      (id === null ? undefined : await readTeamSummary(tx, id)) ?? Promise.reject(notFound()),
  }),
  route(renameTeam, renameTeamHandler),
  route(archiveTeam, archiveTeamHandler),
  route(addTeamMember, addTeamMemberHandler),
  route(removeTeamMember, removeTeamMemberHandler),
];
