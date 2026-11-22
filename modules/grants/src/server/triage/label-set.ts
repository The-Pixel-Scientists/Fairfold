// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tenant's label set (E7): create, rename or recolour, and archive. Each
// change is a configuration version of the label (rule 10) and an audit event
// that names the changed fields, with no label name. Labels are never deleted.
// A name is unique in the tenant whatever its case.

import type { AuditChanges } from '@pixel-scientists/db';

import {
  labelConfigEntityType,
  labelDiff,
  triageMessages,
  type ConfigDiff,
  type Label,
  type LabelColour,
} from '../../contracts/index.ts';
import { recordConfig } from '../programme/change.ts';
import type { Tx } from '../programme/tables.ts';
import type { TriageArgs, TriageDependencies } from './context.ts';
import { triageDb } from './tables.ts';

type Details = Omit<Label, 'id'>;

const columns = ['name', 'colour', 'archived'] as const;

/** The changed fields as audit paths: a name is never a value, a colour token or a flag is. */
const changedFields = (diff: ConfigDiff): AuditChanges =>
  Object.fromEntries(
    diff.map(({ path, from, to }) => [
      `grants.label.${path}`,
      path === 'name' ? {} : { before: from, after: to },
    ]),
  );

export function labelSetHandlers(deps: TriageDependencies) {
  const taken = () => deps.refuse(409, triageMessages.labelTaken);

  async function read(tx: Tx, id: string, lock = false): Promise<Details | undefined> {
    const query = triageDb(tx).selectFrom('grants.label').select(columns).where('id', '=', id);
    return (lock ? query.forUpdate() : query).executeTakeFirst();
  }

  async function nameInUse(tx: Tx, name: string, besides: string): Promise<boolean> {
    const row = await triageDb(tx)
      .selectFrom('grants.label')
      .select('id')
      .where((eb) => eb(eb.fn('lower', ['name']), '=', eb.fn('lower', [eb.val(name)])))
      .where('id', '<>', besides)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** The version and the event of a change that happened. */
  async function changed(
    { tx, context }: Pick<TriageArgs<unknown>, 'tx' | 'context'>,
    action: 'grants.label.created' | 'grants.label.updated' | 'grants.label.archived',
    id: string,
    diff: ConfigDiff,
  ): Promise<void> {
    await recordConfig(deps, tx, context, labelConfigEntityType, id, diff);
    await context.audit.record({ action, entityId: id, changes: changedFields(diff) });
  }

  /** A label as an idempotent create's replay answers it. */
  async function replayLabel({ tx, id }: { tx: Tx; id: string }): Promise<Label> {
    const found = await read(tx, id);
    if (found === undefined) throw deps.notFound();
    return { id, ...found };
  }

  async function createLabel({
    tx,
    context,
    input,
  }: TriageArgs<{ body: { name: string; colour: LabelColour | null } }>): Promise<Label> {
    const { name, colour } = input.body;
    const me = context.membership.id;
    const row = await triageDb(tx)
      .insertInto('grants.label')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        name,
        colour,
        created_by: me,
        updated_by: me,
      }))
      .onConflict((oc) => oc.doNothing())
      .returning('id')
      .executeTakeFirst();
    if (row === undefined) throw taken();
    const details = { name, colour, archived: false };
    await changed({ tx, context }, 'grants.label.created', row.id, labelDiff(null, details));
    return { id: row.id, ...details };
  }

  async function updateLabel({
    tx,
    context,
    input,
  }: TriageArgs<{
    params: { labelId: string };
    body: { name: string; colour: LabelColour | null };
  }>): Promise<Label> {
    const { labelId } = input.params;
    const found = await read(tx, labelId, true);
    if (found === undefined) throw deps.notFound();
    const next = { ...found, ...input.body };
    const diff = labelDiff(found, next);
    if (diff.length > 0) {
      if (await nameInUse(tx, next.name, labelId)) throw taken();
      await triageDb(tx)
        .updateTable('grants.label')
        .set({ name: next.name, colour: next.colour, updated_by: context.membership.id })
        .where('id', '=', labelId)
        .execute();
      await changed({ tx, context }, 'grants.label.updated', labelId, diff);
    }
    return { id: labelId, ...next };
  }

  async function archiveLabel({
    tx,
    context,
    input,
  }: TriageArgs<{ params: { labelId: string } }>): Promise<Label> {
    const { labelId } = input.params;
    const found = await read(tx, labelId, true);
    if (found === undefined) throw deps.notFound();
    if (!found.archived) {
      await triageDb(tx)
        .updateTable('grants.label')
        .set({ archived: true, updated_by: context.membership.id })
        .where('id', '=', labelId)
        .execute();
      await changed(
        { tx, context },
        'grants.label.archived',
        labelId,
        labelDiff(found, { ...found, archived: true }),
      );
    }
    return { id: labelId, ...found, archived: true };
  }

  return { createLabel, updateLabel, archiveLabel, replayLabel };
}
