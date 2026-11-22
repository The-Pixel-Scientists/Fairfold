// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changes to teams (ADR 0037). A team gives its members reach to records and
// nothing else: nothing here reads a role or a permission to decide who is in
// one. The policy has already checked `platform.teams.manage` and step-up.
// Each change locks the team's row first, so two admins acting at once see
// each other's work, and writes its audit event with ids only. An archived
// team and a removed member are final; the database sets when.

import {
  consoleRoleSchema,
  type addTeamMember,
  type archiveTeam,
  type createTeam,
  type removeTeamMember,
  type renameTeam,
} from '@pixel-scientists/domain/platform/team';

import type { TenantTransaction } from '../../database.ts';
import { ApiError } from '../../problems.ts';
import type { Handler } from '../../routes/register.ts';
import { findTeam, readTeamSummary } from './read.ts';
import { teamTables } from './tables.ts';

const UNIQUE_VIOLATION = '23505';

const notFound = () => new ApiError(404, undefined, { reason: 'not_found' });

const conflict = (detail: string, reason: string, cause?: unknown) =>
  new ApiError(409, detail, { reason, cause });

const nameTaken = (cause: unknown) =>
  conflict('A team with this name already exists. Choose another name.', 'team_name_taken', cause);

const archived = () => conflict('This team is archived. It cannot be changed.', 'team_archived');

/** The summary of a team that exists, as it reads now. */
const summaryOf = async (tx: TenantTransaction, id: string) =>
  (await readTeamSummary(tx, id)) ?? Promise.reject(notFound());

/** Turns a duplicate name into a 409; the request's transaction rolls back with it. */
const onDuplicate = (error: unknown): never => {
  throw (error as { code?: unknown }).code === UNIQUE_VIOLATION ? nameTaken(error) : error;
};

export const createTeamHandler: Handler<typeof createTeam> = async ({ tx, context, input }) => {
  const by = context.membership.id;
  const row = await teamTables(tx)
    .insertInto('app.team')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      name: input.body.name,
      created_by: by,
      updated_by: by,
    }))
    .returning('id')
    .executeTakeFirstOrThrow()
    .catch(onDuplicate);
  await context.audit.record({ action: 'platform.team.created', entityId: row.id });
  return summaryOf(tx, row.id);
};

export const renameTeamHandler: Handler<typeof renameTeam> = async ({ tx, context, input }) => {
  const { teamId } = input.params;
  const team = await findTeam(tx, teamId, { lock: true });
  if (team === undefined) throw notFound();
  if (team.archived_at !== null) throw archived();
  if (team.name !== input.body.name) {
    await teamTables(tx)
      .updateTable('app.team')
      .set({ name: input.body.name, updated_by: context.membership.id })
      .where('id', '=', teamId)
      .execute()
      .catch(onDuplicate);
    await context.audit.record({ action: 'platform.team.renamed', entityId: teamId });
  }
  return summaryOf(tx, teamId);
};

export const archiveTeamHandler: Handler<typeof archiveTeam> = async ({ tx, context, input }) => {
  const { teamId } = input.params;
  const team = await findTeam(tx, teamId, { lock: true });
  if (team === undefined) throw notFound();
  if (team.archived_at === null) {
    await teamTables(tx)
      .updateTable('app.team')
      .set({ archived_by: context.membership.id, updated_by: context.membership.id })
      .where('id', '=', teamId)
      .execute();
    await context.audit.record({ action: 'platform.team.archived', entityId: teamId });
  }
  return summaryOf(tx, teamId);
};

/** The ids an access change names, as its audit event holds them. */
const ids = (side: 'before' | 'after', teamId: string, membershipId: string) => ({
  'app.team_member.team_id': { [side]: teamId },
  'app.team_member.membership_id': { [side]: membershipId },
});

const currentRow = (tx: TenantTransaction, teamId: string, membershipId: string) =>
  teamTables(tx)
    .selectFrom('app.team_member')
    .select('id')
    .where('team_id', '=', teamId)
    .where('membership_id', '=', membershipId)
    .where('removed_at', 'is', null)
    .executeTakeFirst();

export const addTeamMemberHandler: Handler<typeof addTeamMember> = async ({
  tx,
  context,
  input,
}) => {
  const { teamId, membershipId } = input.params;
  const db = teamTables(tx);
  const team = await findTeam(tx, teamId, { lock: true });
  if (team === undefined) throw notFound();
  if (team.archived_at !== null) throw archived();

  // A membership of another tenant, or an applicant, reads as one that does not exist.
  const member = await db
    .selectFrom('app.membership')
    .select('id')
    .where('id', '=', membershipId)
    .where('status', '<>', 'removed')
    .where((eb) => eb('roles', '&&', eb.val([...consoleRoleSchema.options])))
    .executeTakeFirst();
  if (member === undefined) throw notFound();
  if ((await currentRow(tx, teamId, membershipId)) !== undefined) return;

  const by = context.membership.id;
  const row = await db
    .insertInto('app.team_member')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      team_id: teamId,
      membership_id: membershipId,
      created_by: by,
      updated_by: by,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  await context.audit.record({
    action: 'platform.team_member.added',
    entityId: row.id,
    changes: ids('after', teamId, membershipId),
  });
};

export const removeTeamMemberHandler: Handler<typeof removeTeamMember> = async ({
  tx,
  context,
  input,
}) => {
  const { teamId, membershipId } = input.params;
  if ((await findTeam(tx, teamId, { lock: true })) === undefined) throw notFound();
  const current = await currentRow(tx, teamId, membershipId);
  if (current === undefined) throw notFound();
  await teamTables(tx)
    .updateTable('app.team_member')
    .set({ removed_by: context.membership.id, updated_by: context.membership.id })
    .where('id', '=', current.id)
    .execute();
  await context.audit.record({
    action: 'platform.team_member.removed',
    entityId: current.id,
    changes: ids('before', teamId, membershipId),
  });
};
