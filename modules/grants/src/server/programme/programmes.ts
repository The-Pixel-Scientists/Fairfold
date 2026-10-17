// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The programme routes' handlers. The platform has already checked the
// session, the permission and the scope rule. Every change writes its
// configuration version (rule 10) and its audit event in the request's
// transaction, and a save that changes nothing writes neither.

import {
  configDiff,
  defaultEmailTemplates,
  outcomeIds,
  type Programme,
  type ProgrammeInput,
  type ProgrammeList,
} from '../../contracts/index.ts';
import { recordConfig } from './change.ts';
import type { Args, GrantsDependencies, ProgrammeParams } from './context.ts';
import { readRounds } from './read.ts';
import { grantsDb } from './tables.ts';
import { columnChanges, programmeColumns, programmeValues, templateValues } from './values.ts';

export function programmeHandlers(deps: GrantsDependencies) {
  async function listProgrammes({ tx }: Args<unknown>): Promise<ProgrammeList> {
    const programmes = await grantsDb(tx)
      .selectFrom('grants.programme')
      .select(['id', 'title', 'summary', 'status'])
      .orderBy((eb) => eb.fn('lower', ['title']))
      .orderBy('id')
      .execute();
    const rounds = await readRounds(tx);
    return {
      programmes: programmes.map((programme) => ({
        ...programme,
        rounds: rounds.filter((round) => round.programmeId === programme.id),
      })),
    };
  }

  async function createProgramme({
    tx,
    context,
    input,
  }: Args<{ body: ProgrammeInput }>): Promise<Programme> {
    const db = grantsDb(tx);
    const actor = context.membership.id;
    const { title, summary, description, status } = input.body;
    const { id } = await db
      .insertInto('grants.programme')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        title,
        summary,
        description,
        status,
        created_by: actor,
        updated_by: actor,
      }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('grants.email_template_version')
      .values((eb) =>
        outcomeIds.map((outcome) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          programme_id: id,
          outcome,
          version: 1,
          ...defaultEmailTemplates[outcome],
          created_by: actor,
        })),
      )
      .execute();

    const diff = configDiff(null, {
      ...programmeValues(input.body),
      ...templateValues(defaultEmailTemplates),
    });
    await recordConfig(deps, tx, context, 'grants.programme', id, diff);
    await context.audit.record({
      action: 'grants.programme.created',
      entityId: id,
      changes: columnChanges('grants.programme', programmeColumns, diff),
    });
    return { id, title, summary, description, status };
  }

  async function getProgramme({ tx, input }: Args<ProgrammeParams>): Promise<Programme> {
    const programme = await grantsDb(tx)
      .selectFrom('grants.programme')
      .select(['id', 'title', 'summary', 'description', 'status'])
      .where('id', '=', input.params.programmeId)
      .executeTakeFirst();
    return programme ?? Promise.reject(deps.notFound());
  }

  async function updateProgramme({
    tx,
    context,
    input,
  }: Args<ProgrammeParams & { body: ProgrammeInput }>): Promise<Programme> {
    const { programmeId } = input.params;
    const found = await grantsDb(tx)
      .selectFrom('grants.programme')
      .select(['title', 'summary', 'description', 'status'])
      .where('id', '=', programmeId)
      .forUpdate()
      .executeTakeFirst();
    if (found === undefined) throw deps.notFound();

    const diff = configDiff(programmeValues(found), programmeValues(input.body));
    if (diff.length > 0) {
      await grantsDb(tx)
        .updateTable('grants.programme')
        .set({ ...input.body, updated_by: context.membership.id })
        .where('id', '=', programmeId)
        .execute();
      await recordConfig(deps, tx, context, 'grants.programme', programmeId, diff);
      await context.audit.record({
        action: 'grants.programme.updated',
        entityId: programmeId,
        changes: columnChanges('grants.programme', programmeColumns, diff),
      });
    }
    return { id: programmeId, ...input.body };
  }

  return { listProgrammes, createProgramme, getProgramme, updateProgramme };
}
