// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Labels on submissions (E7), one or many, all or none, with set semantics:
// adding a label that is on, or removing one that is not, changes nothing.
// A label that is archived is refused here before the insert; the database
// trigger is the backstop and its error is never caught.

import {
  triageMessages,
  type AppliedLabels,
  type BulkLabelChangeInput,
  type BulkTriageResult,
  type Label,
  type LabelChangeInput,
  type LabelList,
} from '../../contracts/index.ts';
import type { Tx } from '../programme/tables.ts';
import type { TriageArgs, TriageContext, TriageDependencies } from './context.ts';
import { lockSubmissions } from './submissions.ts';
import { triageDb } from './tables.ts';

const LABEL = 'grants.application_label.label_id';

const toLabel = (row: {
  id: string;
  name: string;
  colour: Label['colour'];
  archived: boolean;
}): Label => ({ id: row.id, name: row.name, colour: row.colour, archived: row.archived });

export function labelHandlers(deps: TriageDependencies) {
  async function listLabels({ tx }: TriageArgs<object>): Promise<LabelList> {
    const rows = await triageDb(tx)
      .selectFrom('grants.label')
      .select(['id', 'name', 'colour', 'archived'])
      .orderBy((eb) => eb.fn('lower', ['name']))
      .orderBy('id')
      .execute();
    return { labels: rows.map(toLabel) };
  }

  async function change(
    tx: Tx,
    context: TriageContext,
    submissionIds: readonly string[],
    { add = [], remove = [] }: LabelChangeInput,
  ): Promise<number> {
    const ids = await lockSubmissions(tx, deps, submissionIds);
    const db = triageDb(tx);
    const named = [...add, ...remove];
    const labels = await db
      .selectFrom('grants.label')
      .select(['id', 'archived'])
      .where('id', 'in', named)
      .execute();
    if (labels.length !== new Set(named).size) throw deps.notFound();
    if (labels.some((label) => label.archived && add.includes(label.id))) {
      throw deps.refuse(409, triageMessages.labelArchived);
    }

    const on = await db
      .selectFrom('grants.application_label')
      .select(['application_id', 'label_id'])
      .where('application_id', 'in', ids)
      .where('label_id', 'in', named)
      .execute();
    const applied = (id: string) =>
      new Set(on.filter((row) => row.application_id === id).map((row) => row.label_id));
    const changes = ids.map((id) => ({
      id,
      added: add.filter((label) => !applied(id).has(label)),
      removed: remove.filter((label) => applied(id).has(label)),
    }));
    const changing = changes.filter((c) => c.added.length + c.removed.length > 0);

    const additions = changing.flatMap((c) =>
      c.added.map((label) => ({ application: c.id, label })),
    );
    if (additions.length > 0) {
      await db
        .insertInto('grants.application_label')
        .values((eb) =>
          additions.map(({ application, label }) => ({
            tenant_id: eb.fn<string>('app.current_tenant_id', []),
            application_id: application,
            label_id: label,
            added_by: context.membership.id,
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    for (const { id, removed } of changing) {
      if (removed.length === 0) continue;
      await db
        .deleteFrom('grants.application_label')
        .where('application_id', '=', id)
        .where('label_id', 'in', removed)
        .execute();
    }
    for (const { id, added, removed } of changing) {
      await context.audit.record({
        action: 'grants.application.labels_changed',
        entityId: id,
        changes: { [LABEL]: { before: removed, after: added } },
      });
    }
    return changing.length;
  }

  async function changeLabels({
    tx,
    context,
    input,
  }: TriageArgs<{
    params: { submissionId: string };
    body: LabelChangeInput;
  }>): Promise<AppliedLabels> {
    const { submissionId } = input.params;
    await change(tx, context, [submissionId], input.body);
    const rows = await triageDb(tx)
      .selectFrom('grants.application_label as a')
      .innerJoin('grants.label as l', 'l.id', 'a.label_id')
      .select(['l.id', 'l.name', 'l.colour', 'l.archived'])
      .where('a.application_id', '=', submissionId)
      .orderBy((eb) => eb.fn('lower', ['l.name']))
      .orderBy('l.id')
      .execute();
    return { labels: rows.map(toLabel) };
  }

  async function changeLabelsInBulk({
    tx,
    context,
    input,
  }: TriageArgs<{ body: BulkLabelChangeInput }>): Promise<BulkTriageResult> {
    const { submissionIds, ...labels } = input.body;
    return { changed: await change(tx, context, submissionIds, labels) };
  }

  return { listLabels, changeLabels, changeLabelsInBulk };
}
