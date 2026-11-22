// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What an administrator can do to the teams: each change, the call that makes
// it and the words that say what was done. Teams decide which records a
// member can reach; they never give a permission.

import {
  addTeamMember,
  archiveTeam,
  createTeam,
  removeTeamMember,
  renameTeam,
} from '@pixel-scientists/domain/platform/team';
import type { TeamSummary } from '@pixel-scientists/domain/platform/team';

import { callApi } from '../../api.ts';

export interface Person {
  membershipId: string;
  name: string | null;
}

export type TeamChange =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; team: TeamSummary; name: string }
  | { kind: 'archive'; team: TeamSummary }
  | { kind: 'add'; team: TeamSummary; person: Person }
  | { kind: 'remove'; team: TeamSummary; person: Person };

/** The person's name, or a plain stand-in until they have one. */
export const personName = ({ name }: Pick<Person, 'name'>): string => name ?? 'This member';

export interface TeamOutcome {
  /** Says what was done, naming who it was done to. */
  message: string;
  /** The team as it is after the change. */
  team: TeamSummary;
  change: TeamChange;
}

/** Makes the change. Throws the API's problem when it is refused. */
export async function performTeamChange(change: TeamChange): Promise<TeamOutcome> {
  switch (change.kind) {
    case 'create': {
      const team = await callApi(createTeam, { body: { name: change.name } });
      return { message: `Team ${team.name} created. It has no members yet.`, team, change };
    }
    case 'rename': {
      const team = await callApi(renameTeam, {
        params: { teamId: change.team.id },
        body: { name: change.name },
      });
      return { message: `Team renamed to ${team.name}.`, team, change };
    }
    case 'archive': {
      const team = await callApi(archiveTeam, { params: { teamId: change.team.id } });
      return { message: `Team ${team.name} is archived.`, team, change };
    }
    case 'add':
      await callApi(addTeamMember, {
        params: { teamId: change.team.id, membershipId: change.person.membershipId },
      });
      return {
        message: `${personName(change.person)} is in ${change.team.name}.`,
        team: { ...change.team, memberCount: change.team.memberCount + 1 },
        change,
      };
    case 'remove':
      await callApi(removeTeamMember, {
        params: { teamId: change.team.id, membershipId: change.person.membershipId },
      });
      return {
        message: `${personName(change.person)} is no longer in ${change.team.name}.`,
        team: { ...change.team, memberCount: Math.max(0, change.team.memberCount - 1) },
        change,
      };
  }
}
