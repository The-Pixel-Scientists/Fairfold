// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The learning note routes' handlers. A note is added or removed, never
// edited. Its audit events name the note and its outcome, never its words.

import {
  impactMessages,
  type LearningNote,
  type LearningNoteInput,
  type LearningNoteList,
} from '../contracts/index.ts';
import {
  impactDb,
  iso,
  type Args,
  type FrameworkParams,
  type ImpactDependencies,
} from './context.ts';
import { readFrameworkRow, writeChecks } from './read.ts';

const columns = ['id', 'framework_id', 'outcome_id', 'body', 'created_at'] as const;

const toNote = (row: {
  id: string;
  framework_id: string;
  outcome_id: string | null;
  body: string;
  created_at: Date;
}): LearningNote => ({
  id: row.id,
  frameworkId: row.framework_id,
  outcomeId: row.outcome_id,
  text: row.body,
  createdAt: iso(row.created_at),
});

export function noteHandlers(deps: ImpactDependencies) {
  const checks = writeChecks(deps);

  async function listLearningNotes({
    tx,
    input,
  }: Args<FrameworkParams>): Promise<LearningNoteList> {
    const { frameworkId } = input.params;
    if ((await readFrameworkRow(tx, frameworkId)) === undefined) throw deps.notFound();
    const rows = await impactDb(tx)
      .selectFrom('impact.learning_note')
      .select(columns)
      .where('framework_id', '=', frameworkId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return { notes: rows.map(toNote) };
  }

  async function createLearningNote({
    tx,
    context,
    input,
  }: Args<{ body: LearningNoteInput }>): Promise<LearningNote> {
    const db = impactDb(tx);
    const { frameworkId, outcomeId, text } = input.body;
    await checks.openFramework(tx, frameworkId);
    if (outcomeId !== null) {
      const outcome = await db
        .selectFrom('impact.outcome')
        .select('id')
        .where('framework_id', '=', frameworkId)
        .where('id', '=', outcomeId)
        .forShare()
        .executeTakeFirst();
      if (outcome === undefined) throw checks.field('outcomeId', impactMessages.outcome);
    }
    const row = await db
      .insertInto('impact.learning_note')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        framework_id: frameworkId,
        outcome_id: outcomeId,
        body: text,
        created_by: context.membership.id,
      }))
      .returning(columns)
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'impact.learning_note.added',
      entityId: row.id,
      changes: {
        'impact.learning_note.framework_id': { after: frameworkId },
        'impact.learning_note.outcome_id': { after: outcomeId },
      },
    });
    return toNote(row);
  }

  /** For a replay of the add: the note as it reads now. */
  async function getLearningNote({
    tx,
    input,
  }: Args<{ params: { noteId: string } }>): Promise<LearningNote> {
    const row = await impactDb(tx)
      .selectFrom('impact.learning_note')
      .select(columns)
      .where('id', '=', input.params.noteId)
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return toNote(row);
  }

  async function removeLearningNote({
    tx,
    context,
    input,
  }: Args<{ params: { noteId: string } }>): Promise<undefined> {
    const db = impactDb(tx);
    const { noteId } = input.params;
    const found = await db
      .selectFrom('impact.learning_note')
      .select(['framework_id', 'outcome_id'])
      .where('id', '=', noteId)
      .executeTakeFirst();
    if (found === undefined) throw deps.notFound();
    await checks.openFramework(tx, found.framework_id);
    await db.deleteFrom('impact.learning_note').where('id', '=', noteId).execute();
    await context.audit.record({
      action: 'impact.learning_note.removed',
      entityId: noteId,
      changes: {
        'impact.learning_note.framework_id': { before: found.framework_id },
        'impact.learning_note.outcome_id': { before: found.outcome_id },
      },
    });
    return undefined;
  }

  return { listLearningNotes, createLearningNote, getLearningNote, removeLearningNote };
}
