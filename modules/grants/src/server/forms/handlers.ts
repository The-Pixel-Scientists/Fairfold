// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The form version routes' handlers (ADR 0004), matched with their contracts
// in apps/api/src/modules.ts. A round has at most one draft. Only a draft
// changes: saving replaces its definition, publishing fixes it as the next
// version and discarding removes it. A request that changes a draft locks it
// first, so one that loses a race to publish or discard gets a 409, and a save
// is never lost under a publication that read the draft before it.

import { messages, type FieldProblem } from '@pixel-scientists/domain/platform';

import {
  formConfigEntityType,
  formDiff,
  formVersionDiffSchema,
  type FormDraftInput,
  type FormVersion,
  type FormVersionDiff,
  type FormVersionList,
} from '../../contracts/index.ts';
import type { Args, GrantsContext, RoundParams } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';
import { formRefusals, recheck, typeProblems } from './checks.ts';
import type { FormDependencies, VersionParams } from './context.ts';
import {
  definitionOf,
  findVersion,
  publishedDefinitions,
  readVersion,
  readVersions,
  roundExists,
  type VersionRow,
} from './read.ts';
import { formsDb, isDuplicate } from './tables.ts';

const column = (name: string) => `grants.form_version.${name}`;

export function formHandlers(deps: FormDependencies) {
  const refuseFields = (problems: readonly FieldProblem[]) =>
    deps.refuse(400, messages.fixFields, problems);

  /**
   * The draft, locked until the request ends. A published version cannot be
   * locked, since the database matches drafts only, so it is read first.
   */
  async function lockedDraft(tx: Tx, id: string, whenPublished: string): Promise<VersionRow> {
    const row = await findVersion(tx, id);
    if (row === undefined) throw deps.notFound();
    if (row.status === 'published') throw deps.refuse(409, whenPublished);
    return (
      (await findVersion(tx, id, true)) ?? Promise.reject(deps.refuse(409, formRefusals.changed))
    );
  }

  async function answer(tx: Tx, id: string): Promise<FormVersion> {
    return (await readVersion(tx, id)) ?? Promise.reject(deps.notFound());
  }

  async function listFormVersions({ tx, input }: Args<RoundParams>): Promise<FormVersionList> {
    const { roundId } = input.params;
    if (!(await roundExists(tx, roundId))) throw deps.notFound();
    return { versions: await readVersions(tx, roundId) };
  }

  async function createFormDraft({ tx, context, input }: Args<RoundParams>): Promise<FormVersion> {
    const { roundId } = input.params;
    if (!(await roundExists(tx, roundId))) throw deps.notFound();
    const latest = await formsDb(tx)
      .selectFrom('grants.form_version')
      .select(['version', 'status', 'definition'])
      .where('round_id', '=', roundId)
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (latest?.status === 'draft') throw deps.refuse(409, formRefusals.draftExists);

    const version = (latest?.version ?? 0) + 1;
    const actor = context.membership.id;
    let id: string;
    try {
      ({ id } = await formsDb(tx)
        .insertInto('grants.form_version')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          round_id: roundId,
          version,
          definition: latest === undefined ? null : JSON.stringify(latest.definition),
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow());
    } catch (error) {
      // Another request started a draft first.
      throw isDuplicate(error) ? deps.refuse(409, formRefusals.draftExists) : error;
    }
    await context.audit.record({
      action: 'grants.form_version.created',
      entityId: id,
      changes: {
        [column('version')]: { before: null, after: version },
        [column('status')]: { before: null, after: 'draft' },
      },
    });
    return answer(tx, id);
  }

  async function getFormVersion({ tx, input }: Args<VersionParams>): Promise<FormVersion> {
    return answer(tx, input.params.formVersionId);
  }

  async function saveFormDraft({
    tx,
    context,
    input,
  }: Args<VersionParams & { body: FormDraftInput }>): Promise<FormVersion> {
    const { formVersionId } = input.params;
    const { definition } = input.body;
    const row = await lockedDraft(tx, formVersionId, formRefusals.published);
    const problems = typeProblems(
      await publishedDefinitions(tx, row.round_id),
      definition,
      'body.definition',
    );
    if (problems.length > 0) throw refuseFields(problems);

    if (formDiff(definitionOf(row.definition), definition).changes.length > 0) {
      await formsDb(tx)
        .updateTable('grants.form_version')
        .set({ definition: JSON.stringify(definition), updated_by: context.membership.id })
        .where('id', '=', formVersionId)
        .returning('id')
        .executeTakeFirstOrThrow();
      await context.audit.record({
        action: 'grants.form_version.updated',
        entityId: formVersionId,
        changes: { [column('definition')]: {} },
      });
    }
    return answer(tx, formVersionId);
  }

  /** The version's configuration history is the round's: its entity id is the round's. */
  function recordForm(
    tx: Tx,
    context: GrantsContext,
    roundId: string,
    diff: FormVersionDiff,
  ): Promise<void> {
    return deps.recordConfig(
      tx,
      context.membership.id,
      formConfigEntityType,
      roundId,
      formVersionDiffSchema.parse(diff).changes,
    );
  }

  async function publishFormDraft({
    tx,
    context,
    input,
  }: Args<VersionParams>): Promise<FormVersion> {
    const { formVersionId } = input.params;
    const row = await lockedDraft(tx, formVersionId, formRefusals.alreadyPublished);
    if (row.definition === null) throw deps.refuse(409, formRefusals.nothingSaved);

    const checked = recheck(row.definition, 'definition');
    if ('problems' in checked) throw refuseFields(checked.problems);
    const { definition } = checked;
    const earlier = await publishedDefinitions(tx, row.round_id);
    const problems = typeProblems(earlier, definition, 'definition');
    if (problems.length > 0) throw refuseFields(problems);

    const actor = context.membership.id;
    await formsDb(tx)
      .updateTable('grants.form_version')
      .set((eb) => ({
        status: 'published',
        definition: JSON.stringify(definition),
        published_at: eb.fn<Date>('now', []),
        published_by: actor,
        updated_by: actor,
      }))
      .where('id', '=', formVersionId)
      .returning('id')
      .executeTakeFirstOrThrow();

    await recordForm(tx, context, row.round_id, formDiff(earlier.at(-1) ?? null, definition));
    await context.audit.record({
      action: 'grants.form_version.published',
      entityId: formVersionId,
      changes: {
        [column('version')]: { before: null, after: row.version },
        [column('status')]: { before: 'draft', after: 'published' },
      },
    });
    return answer(tx, formVersionId);
  }

  async function discardFormDraft({ tx, context, input }: Args<VersionParams>): Promise<undefined> {
    const { formVersionId } = input.params;
    const row = await lockedDraft(tx, formVersionId, formRefusals.published);
    await formsDb(tx)
      .deleteFrom('grants.form_version')
      .where('id', '=', formVersionId)
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'grants.form_version.discarded',
      entityId: formVersionId,
      changes: { [column('version')]: { before: row.version, after: null } },
    });
    return undefined;
  }

  return {
    listFormVersions,
    createFormDraft,
    getFormVersion,
    saveFormDraft,
    publishFormDraft,
    discardFormDraft,
  };
}
