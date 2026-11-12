// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The note and message service (ADR 0030): platform records that a module
// links to its own records through its own join table, so nothing here
// knows what a note or thread is about. Every call runs in the request's
// tenant transaction, so row-level security keeps it to that tenant. Bodies
// are returned as the records the domain projects; no caller sends one as it
// is. The author of a record is the caller's, never from a request.

import type {
  MemberName,
  MessageRecord,
  MessageSide,
  NoteRecord,
  ThreadRecord,
} from '@pixel-scientists/domain/notes';
import type { Permission } from '@pixel-scientists/domain/platform';
import { peopleByUserIds } from '@pixel-scientists/party/server';

import type { TenantTransaction } from '../../database.ts';
import { membersWith } from '../members.ts';
import { notesDb } from './tables.ts';

type Tx = TenantTransaction;

/** Each membership's display name, or null when their account has no person record. */
async function namesOf(
  tx: Tx,
  membershipIds: readonly string[],
): Promise<ReadonlyMap<string, MemberName>> {
  const ids = [...new Set(membershipIds)];
  if (ids.length === 0) return new Map();
  const members = await notesDb(tx)
    .selectFrom('app.membership')
    .select(['id', 'user_id'])
    .where('id', 'in', ids)
    .execute();
  const people = await peopleByUserIds(
    tx,
    members.map((member) => member.user_id),
  );
  return new Map(
    members.map((member) => {
      const person = people.get(member.user_id);
      const name = [person?.givenName, person?.familyName].filter(Boolean).join(' ');
      return [member.id, { membershipId: member.id, name: name === '' ? null : name }];
    }),
  );
}

/** The active members who hold `permission`, by name: whom a note on a record that permission opens may mention. */
async function mentionable(tx: Tx, permission: Permission): Promise<MemberName[]> {
  const names = await namesOf(tx, await membersWith(tx, permission));
  return [...names.values()].sort((a, b) => a.membershipId.localeCompare(b.membershipId));
}

/** Writes a note and its mentions; the caller has checked the mentions and links the note. */
async function addNote(
  tx: Tx,
  note: { authorId: string; body: string; mentions: readonly string[] },
): Promise<string> {
  const db = notesDb(tx);
  const { id } = await db
    .insertInto('app.note')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      body: note.body,
      author_id: note.authorId,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  if (note.mentions.length > 0) {
    await db
      .insertInto('app.note_mention')
      .values((eb) =>
        note.mentions.map((membershipId) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          note_id: id,
          membership_id: membershipId,
        })),
      )
      .execute();
  }
  return id;
}

/** These notes, newest first, with the names of their authors and mentions. */
async function readNotes(tx: Tx, noteIds: readonly string[]): Promise<NoteRecord[]> {
  if (noteIds.length === 0) return [];
  const db = notesDb(tx);
  const notes = await db
    .selectFrom('app.note')
    .select(['id', 'body', 'author_id', 'created_at'])
    .where('id', 'in', noteIds)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const mentions = await db
    .selectFrom('app.note_mention')
    .select(['note_id', 'membership_id'])
    .where('note_id', 'in', noteIds)
    .orderBy('membership_id')
    .execute();
  const names = await namesOf(tx, [
    ...notes.map((note) => note.author_id),
    ...mentions.map((mention) => mention.membership_id),
  ]);
  const member = (id: string): MemberName => names.get(id) ?? { membershipId: id, name: null };
  return notes.map((note) => ({
    id: note.id,
    body: note.body,
    author: member(note.author_id),
    mentions: mentions.filter((m) => m.note_id === note.id).map((m) => member(m.membership_id)),
    createdAt: note.created_at,
  }));
}

async function addThread(tx: Tx): Promise<string> {
  const { id } = await notesDb(tx)
    .insertInto('app.message_thread')
    .values((eb) => ({ tenant_id: eb.fn<string>('app.current_tenant_id', []) }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** Writes a message: a staff one by the caller's membership, an applicant's by their person. */
async function addMessage(
  tx: Tx,
  message: { threadId: string; side: MessageSide; body: string; authorId: string },
): Promise<string> {
  const { id } = await notesDb(tx)
    .insertInto('app.message')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      thread_id: message.threadId,
      side: message.side,
      body: message.body,
      author_membership_id: message.side === 'staff' ? message.authorId : null,
      author_person_id: message.side === 'applicant' ? message.authorId : null,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** A thread's messages, oldest first, and each side's last-read time. */
async function readThread(tx: Tx, threadId: string): Promise<ThreadRecord> {
  const db = notesDb(tx);
  const thread = await db
    .selectFrom('app.message_thread')
    .select(['applicant_read_at', 'staff_read_at'])
    .where('id', '=', threadId)
    .executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom('app.message')
    .select(['id', 'thread_id', 'side', 'body', 'author_membership_id', 'author_person_id'])
    .select('created_at')
    .where('thread_id', '=', threadId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const names = await namesOf(
    tx,
    rows.flatMap((row) => (row.author_membership_id === null ? [] : [row.author_membership_id])),
  );
  const messages = rows.map((row): MessageRecord => ({
    id: row.id,
    threadId: row.thread_id,
    side: row.side,
    body: row.body,
    authorId: row.author_membership_id ?? row.author_person_id ?? row.id,
    authorName:
      row.author_membership_id === null
        ? null
        : (names.get(row.author_membership_id)?.name ?? null),
    createdAt: row.created_at,
  }));
  return { messages, applicantReadAt: thread.applicant_read_at, staffReadAt: thread.staff_read_at };
}

/** Marks the thread read on one side; the database sets the time. */
async function markRead(tx: Tx, threadId: string, side: MessageSide): Promise<void> {
  await notesDb(tx)
    .updateTable('app.message_thread')
    .set((eb) =>
      side === 'staff'
        ? { staff_read_at: eb.fn<Date>('now', []) }
        : { applicant_read_at: eb.fn<Date>('now', []) },
    )
    .where('id', '=', threadId)
    .execute();
}

export const notesPlatform = {
  mentionable,
  addNote,
  readNotes,
  addThread,
  addMessage,
  readThread,
  markRead,
} as const;
