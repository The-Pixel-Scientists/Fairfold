// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Platform notes, messages and tags (ADR 0030): the `/notes` subpath of the
// domain package.

import '../jitless/index.ts';

export {
  checkMentions,
  MAX_MENTIONS,
  MAX_MESSAGE_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TAG_LABEL_LENGTH,
  mentionsSchema,
  messageBodySchema,
  noteBodySchema,
  tagLabelSchema,
} from './body.ts';
export { notesMessages, type NotesMessage } from './messages.ts';
export {
  applicantMessageSchema,
  applicantThreadSchema,
  memberNameSchema,
  noteViewSchema,
  projectMessage,
  projectNote,
  projectThread,
  staffMessageSchema,
  staffThreadSchema,
  type ApplicantMessage,
  type ApplicantThread,
  type NoteView,
  type StaffMessage,
  type StaffThread,
} from './project.ts';
export {
  messageSides,
  type MemberName,
  type MessageRecord,
  type MessageSide,
  type NoteRecord,
  type TagRecord,
  type ThreadRecord,
} from './records.ts';
