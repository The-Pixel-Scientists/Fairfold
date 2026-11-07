// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Staff notes on a submitted application (ADR 0004, ADR 0030): platform
// notes that grants links through `grants.application_note` (S12-13). The
// routes sit under the submission routes, so a draft answers 404, as if it
// did not exist, and so does another tenant's application.
//
// The rules:
// - members with `grants.applications.read` list and add notes, anywhere in
//   the tenant; no portal or reviewer route exists, and projectNote() gives
//   every audience but staff nothing;
// - notes are append-only: no edit or delete route, so a correction is a new
//   note;
// - the author is the session's membership and the application the path's
//   (rule 6); the body names neither;
// - a mention is a membership id in `mentions`, never `@name` in the body.
//   The server re-reads, at write time in the request's tenant, every active
//   member holding `grants.applications.read`, and refuses through
//   checkMentions() any id outside that set, with words that name no one.
//   `listMentionableMembers` gives the console the same set to pick from;
// - adding records `grants.application.note_added` against the application
//   id, so its subject is the applicant (ADR 0027), with the note id and the
//   number of mentions in its changes; never the body or a name.

import { idSchema } from '@pixel-scientists/domain';
import { defineRoute } from '@pixel-scientists/domain/api';
import {
  memberNameSchema,
  mentionsSchema,
  noteBodySchema,
  noteViewSchema,
} from '@pixel-scientists/domain/notes';
import { z } from 'zod';

const staff = {
  audience: 'console',
  module: 'grants',
  permission: 'grants.applications.read',
  scope: 'tenant',
} as const;

const submission = z.strictObject({ submissionId: idSchema });

/** An application's notes, newest first. */
export const noteListSchema = z.strictObject({ notes: z.array(noteViewSchema) });

export type NoteList = z.infer<typeof noteListSchema>;

export const addNoteInputSchema = z.strictObject({
  body: noteBodySchema,
  mentions: mentionsSchema.default([]),
});

export type AddNoteInput = z.input<typeof addNoteInputSchema>;

/** The members a note on this application may mention, by name. */
export const mentionableMembersSchema = z.strictObject({ members: z.array(memberNameSchema) });

export type MentionableMembers = z.infer<typeof mentionableMembersSchema>;

export const listNotes = defineRoute({
  ...staff,
  method: 'GET',
  path: '/console/submissions/:submissionId/notes',
  summary: 'List the staff notes on a submission, newest first',
  params: submission,
  responses: { 200: noteListSchema },
});

export const addNote = defineRoute({
  ...staff,
  method: 'POST',
  idempotent: true,
  path: '/console/submissions/:submissionId/notes',
  summary: 'Add a staff note to a submission, mentioning members who may see it',
  params: submission,
  body: addNoteInputSchema,
  responses: { 201: noteViewSchema },
});

export const listMentionableMembers = defineRoute({
  ...staff,
  method: 'GET',
  path: '/console/submissions/:submissionId/mentionable-members',
  summary: 'List the members a note on a submission may mention',
  params: submission,
  responses: { 200: mentionableMembersSchema },
});

export const noteRoutes = { listNotes, addNote, listMentionableMembers } as const;
