// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Staff notes on a submission (ADR 0004, ADR 0030), matched with their
// contracts in apps/api/src/modules.ts. Notes are for staff alone: they are
// read only through the staff projection, and no portal or reviewer route
// reaches them. The author is the session's member. A note, its mentions and
// its link to the application are written in one transaction. A mention is
// accepted only for a member who holds the permission to read applications,
// checked again here from the tenant's memberships at write time.

import {
  checkMentions,
  notesMessages,
  projectNote,
  type NoteView,
} from '@pixel-scientists/domain/notes';

import type { AddNoteInput, MentionableMembers, NoteList } from '../../contracts/index.ts';
import { submittedApplication } from './application.ts';
import type { NoteArgs, NoteDependencies } from './context.ts';
import { noteDb } from './tables.ts';

const READ = 'grants.applications.read';

type Submission = { params: { submissionId: string } };

export function noteHandlers(deps: NoteDependencies) {
  async function listNotes({ tx, input }: NoteArgs<Submission>): Promise<NoteList> {
    const { submissionId } = input.params;
    if ((await submittedApplication(tx, submissionId)) === undefined) throw deps.notFound();
    const links = await noteDb(tx)
      .selectFrom('grants.application_note')
      .select('note_id')
      .where('application_id', '=', submissionId)
      .execute();
    const records = await deps.notes.readNotes(
      tx,
      links.map((link) => link.note_id),
    );
    return { notes: records.flatMap((record) => projectNote(record, 'staff') ?? []) };
  }

  async function listMentionableMembers({
    tx,
    input,
  }: NoteArgs<Submission>): Promise<MentionableMembers> {
    if ((await submittedApplication(tx, input.params.submissionId)) === undefined) {
      throw deps.notFound();
    }
    return { members: await deps.notes.mentionable(tx, READ) };
  }

  async function addNote({
    tx,
    context,
    input,
  }: NoteArgs<Submission & { body: AddNoteInput }>): Promise<NoteView> {
    const { submissionId } = input.params;
    const { body, mentions = [] } = input.body;
    if ((await submittedApplication(tx, submissionId)) === undefined) throw deps.notFound();

    const allowed = new Set((await deps.notes.mentionable(tx, READ)).map((m) => m.membershipId));
    const problems = checkMentions(mentions, allowed);
    if (problems.length > 0) throw deps.refuse(400, notesMessages.mentionNotAllowed, problems);

    const noteId = await deps.notes.addNote(tx, {
      authorId: context.membership.id,
      body,
      mentions,
    });
    await noteDb(tx)
      .insertInto('grants.application_note')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        note_id: noteId,
        application_id: submissionId,
      }))
      .execute();
    await context.audit.record({
      action: 'grants.application.note_added',
      entityId: submissionId,
      changes: {
        'app.note.id': { after: noteId },
        'app.note_mention.membership_id': { after: mentions },
      },
    });
    const [record] = await deps.notes.readNotes(tx, [noteId]);
    const view = record === undefined ? null : projectNote(record, 'staff');
    if (view === null) throw new Error('The note just written was not found.');
    return view;
  }

  return { listNotes, listMentionableMembers, addNote };
}
