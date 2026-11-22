// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reading teams: each with its current members, shown by membership id and
// name from the person record, never by email. A removed membership is not a
// member.

import type { TeamDetail, TeamSummary } from '@pixel-scientists/domain/platform/team';
import { peopleByUserIds } from '@pixel-scientists/party/server';

import type { TenantTransaction } from '../../database.ts';
import { teamTables, type TeamRow } from './tables.ts';

/** The team's row, or undefined where it does not exist in the tenant. Lock it to serialise changes. */
export function findTeam(tx: TenantTransaction, id: string, options: { lock: boolean }) {
  const query = teamTables(tx)
    .selectFrom('app.team')
    .select(['id', 'name', 'archived_at'])
    .where('id', '=', id);
  return options.lock ? query.forNoKeyUpdate().executeTakeFirst() : query.executeTakeFirst();
}

function currentMembers(tx: TenantTransaction, teamId?: string) {
  const query = teamTables(tx)
    .selectFrom('app.team_member')
    .innerJoin('app.membership', 'app.membership.id', 'app.team_member.membership_id')
    .select([
      'app.team_member.team_id as team_id',
      'app.team_member.membership_id as membership_id',
      'app.membership.user_id as user_id',
      'app.membership.status as status',
    ])
    .where('app.team_member.removed_at', 'is', null)
    .where('app.membership.status', '<>', 'removed')
    .orderBy('app.team_member.membership_id');
  return (
    teamId === undefined ? query : query.where('app.team_member.team_id', '=', teamId)
  ).execute();
}

const summary = (team: TeamRow, memberCount: number): TeamSummary => ({
  id: team.id,
  name: team.name,
  memberCount,
  archivedAt: team.archived_at?.toISOString() ?? null,
});

/** Every team of the tenant, archived ones included, by name. */
export async function listTeamSummaries(tx: TenantTransaction): Promise<TeamSummary[]> {
  const [teams, members] = await Promise.all([
    teamTables(tx)
      .selectFrom('app.team')
      .select(['id', 'name', 'archived_at'])
      .orderBy('name')
      .orderBy('id')
      .execute(),
    currentMembers(tx),
  ]);
  return teams.map((team) =>
    summary(team, members.filter((member) => member.team_id === team.id).length),
  );
}

/** One team as it reads now, or undefined where it does not exist. */
export async function readTeamSummary(
  tx: TenantTransaction,
  id: string,
): Promise<TeamSummary | undefined> {
  const team = await findTeam(tx, id, { lock: false });
  return team && summary(team, (await currentMembers(tx, id)).length);
}

export async function readTeamDetail(
  tx: TenantTransaction,
  id: string,
): Promise<TeamDetail | undefined> {
  const team = await findTeam(tx, id, { lock: false });
  if (team === undefined) return undefined;
  const members = await currentMembers(tx, id);
  const people = await peopleByUserIds(
    tx,
    members.map((member) => member.user_id),
  );
  return {
    ...summary(team, members.length),
    members: members.map((member) => {
      const person = people.get(member.user_id);
      const name = [person?.givenName, person?.familyName].filter(Boolean).join(' ');
      return {
        membershipId: member.membership_id,
        name: name === '' ? null : name,
        status: member.status === 'suspended' ? 'suspended' : 'active',
      };
    }),
  };
}
