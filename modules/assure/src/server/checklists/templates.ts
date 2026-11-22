// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checklist routes' handlers. A checklist is versioned configuration
// (rule 10): creating one and publishing a new version each insert an
// immutable version row, move `current_version` up by one, and write the
// `assure.checklist` configuration version, all in the request's
// transaction. The audit events hold the checklist's id and the version
// number, never an item. The author is the member in the session.

import { idSchema } from '@pixel-scientists/domain';

import {
  checklistInputSchema,
  type ChecklistInput,
  type ChecklistVersion,
} from '../../contracts/index.ts';
import {
  assureDb,
  isRefusedByRule,
  isTaken,
  iso,
  type Args,
  type AssureDb,
  type ChecklistDependencies,
  type Tx,
} from './context.ts';
import { checklistDiff, settleIds, type Item } from './items.ts';

const NAME_TAKEN = 'A checklist with that name already exists. Choose a different name.';
const NOTHING_CHANGED = 'Change the checklist before you publish a new version.';
const OUT_OF_DATE = 'Someone else has changed this checklist. Reload it and try again.';
const CHECK_INPUT = 'Check the checklist and try again.';

/** A version's columns, as the response handlers read them too. */
export const versionColumns = [
  'v.id',
  'v.version',
  'v.name',
  'v.description',
  'v.items',
  'v.created_at',
] as const;

export interface VersionRow {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly items: unknown;
  readonly created_at: Date;
}

export const toVersion = (row: VersionRow): ChecklistVersion => ({
  id: row.id,
  number: row.version,
  name: row.name,
  description: row.description,
  items: row.items as Item[],
  publishedAt: iso(row.created_at),
});

/** Every checklist with its newest version. */
export const currentVersions = (db: AssureDb) =>
  db
    .selectFrom('assure.checklist as c')
    .innerJoin('assure.checklist_version as v', (join) =>
      join.onRef('v.checklist_id', '=', 'c.id').onRef('v.version', '=', 'c.current_version'),
    )
    .select(['c.id as checklist_id', 'c.archived_at', ...versionColumns]);

export function templateHandlers(deps: ChecklistDependencies) {
  const idOrNotFound = (value: unknown): string => {
    const parsed = idSchema.safeParse(value);
    if (!parsed.success) throw deps.notFound();
    return parsed.data;
  };

  const checklistInput = (body: unknown): ChecklistInput => {
    const parsed = checklistInputSchema.safeParse(body);
    if (!parsed.success) throw deps.refuse(400, CHECK_INPUT);
    return parsed.data;
  };

  async function readChecklist(db: AssureDb, checklistId: string) {
    const row = await currentVersions(db).where('c.id', '=', checklistId).executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return { id: row.checklist_id, version: toVersion(row) };
  }

  /** Inserts a version and moves the checklist to it; the trigger refuses a skipped one. */
  async function writeVersion(
    db: AssureDb,
    checklistId: string,
    number: number,
    content: ChecklistInput,
    actor: string,
  ): Promise<void> {
    await db
      .insertInto('assure.checklist_version')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        checklist_id: checklistId,
        version: number,
        name: content.name,
        description: content.description,
        items: JSON.stringify(content.items),
        published_by: actor,
      }))
      .execute();
    await db
      .updateTable('assure.checklist')
      .set({ name: content.name, current_version: number, updated_by: actor })
      .where('id', '=', checklistId)
      .execute();
  }

  /** Turns the failures a request can foresee but not rule out into plain refusals. */
  async function guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isTaken(error)) throw deps.refuse(409, NAME_TAKEN);
      if (isRefusedByRule(error)) throw deps.refuse(409, OUT_OF_DATE);
      throw error;
    }
  }

  async function listChecklists({ tx }: Args<unknown>) {
    const rows = await currentVersions(assureDb(tx))
      .where('c.archived_at', 'is', null)
      .orderBy('v.name')
      .orderBy('c.id')
      .execute();
    return {
      checklists: rows.map((row) => ({
        id: row.checklist_id,
        name: row.name,
        versionNumber: row.version,
        publishedAt: iso(row.created_at),
      })),
    };
  }

  const getChecklist = ({ tx, input }: Args<{ params: { checklistId: string } }>) =>
    readChecklist(assureDb(tx), idOrNotFound(input.params.checklistId));

  /** For a replay of either write: the checklist as it reads now. */
  const replayChecklist = ({ tx, id }: { tx: Tx; id: string | null }) =>
    readChecklist(assureDb(tx), idOrNotFound(id));

  async function createChecklist({ tx, context, input }: Args<{ body: unknown }>) {
    const body = checklistInput(input.body);
    const db = assureDb(tx);
    const actor = context.membership.id;
    const content = { ...body, items: settleIds([], body.items) };
    const id = await guarded(async () => {
      const { id: created } = await db
        .insertInto('assure.checklist')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          name: content.name,
          created_by: actor,
          updated_by: actor,
        }))
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeVersion(db, created, 1, content, actor);
      return created;
    });
    await context.config.record('assure.checklist', id, checklistDiff(null, content));
    await context.audit.record({
      action: 'assure.checklist.created',
      entityId: id,
      changes: { 'assure.checklist_version.version': { after: 1 } },
    });
    return readChecklist(db, id);
  }

  async function publishChecklistVersion({
    tx,
    context,
    input,
  }: Args<{ params: { checklistId: string }; body: unknown }>) {
    const checklistId = idOrNotFound(input.params.checklistId);
    const body = checklistInput(input.body);
    const db = assureDb(tx);
    const actor = context.membership.id;
    const locked = await db
      .selectFrom('assure.checklist')
      .select(['current_version', 'archived_at'])
      .where('id', '=', checklistId)
      .forUpdate()
      .executeTakeFirst();
    if (locked === undefined) throw deps.notFound();
    if (locked.archived_at !== null || locked.current_version === null) {
      throw deps.refuse(409, 'This checklist is archived, so it takes no new versions.');
    }
    const { version: before } = await readChecklist(db, checklistId);
    const content = { ...body, items: settleIds(before.items, body.items) };
    const diff = checklistDiff(before, content);
    if (diff.length === 0) throw deps.refuse(409, NOTHING_CHANGED);

    const number = locked.current_version + 1;
    await guarded(() => writeVersion(db, checklistId, number, content, actor));
    await context.config.record('assure.checklist', checklistId, diff);
    await context.audit.record({
      action: 'assure.checklist.published',
      entityId: checklistId,
      changes: { 'assure.checklist_version.version': { after: number } },
    });
    return readChecklist(db, checklistId);
  }

  return {
    listChecklists,
    getChecklist,
    createChecklist,
    publishChecklistVersion,
    replayChecklist,
  };
}
