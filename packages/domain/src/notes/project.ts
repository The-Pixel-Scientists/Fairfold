// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What each audience sees of notes and messages (ADR 0004, ADR 0030). Each
// view is built field by field as a new object, so a property added to a
// record later never reaches a response by accident.
//
// - Notes are for staff alone. Every other audience gets nothing.
// - The applicant sees their own messages and the funder's, never which
//   member wrote one: no staff name or id.
// - Staff see the member who wrote each funder message. The applicant's
//   name comes only from the application's own projection.
// - Reviewers, blind or not, and any other audience get nothing: a message
//   or note can name the applicant, so blind review cannot show either.

import { z } from 'zod';

import type { ProjectionAudience } from '../forms/audience.ts';
import { idSchema } from '../id.ts';
import {
  messageSides,
  type MemberName,
  type MessageRecord,
  type NoteRecord,
  type ThreadRecord,
} from './records.ts';

export const memberNameSchema = z.strictObject({
  membershipId: idSchema,
  name: z.string().nullable(),
});

export const noteViewSchema = z.strictObject({
  id: idSchema,
  body: z.string(),
  author: memberNameSchema,
  mentions: z.array(memberNameSchema),
  createdAt: z.iso.datetime(),
});

export type NoteView = z.infer<typeof noteViewSchema>;

/** `unread` marks a message from the other side since the caller's side last read the thread. */
export const applicantMessageSchema = z.strictObject({
  id: idSchema,
  side: z.enum(messageSides),
  body: z.string(),
  sentAt: z.iso.datetime(),
  unread: z.boolean(),
});

export type ApplicantMessage = z.infer<typeof applicantMessageSchema>;

/** `authorName` is set on funder messages only. */
export const staffMessageSchema = applicantMessageSchema.extend({
  authorName: z.string().nullable(),
});

export type StaffMessage = z.infer<typeof staffMessageSchema>;

/** Oldest first, with the count of messages unread on the caller's side only. */
export const applicantThreadSchema = z.strictObject({
  messages: z.array(applicantMessageSchema),
  unreadCount: z.int().min(0),
});

export type ApplicantThread = z.infer<typeof applicantThreadSchema>;

export const staffThreadSchema = z.strictObject({
  messages: z.array(staffMessageSchema),
  unreadCount: z.int().min(0),
});

export type StaffThread = z.infer<typeof staffThreadSchema>;

function member({ membershipId, name }: MemberName): MemberName {
  return { membershipId, name };
}

/** A note for staff; nothing for anyone else. */
export function projectNote(note: NoteRecord, audience: ProjectionAudience): NoteView | null {
  if (audience !== 'staff') return null;
  return {
    id: note.id,
    body: note.body,
    author: member(note.author),
    mentions: note.mentions.map(member),
    createdAt: note.createdAt.toISOString(),
  };
}

/** A message as `audience` sees it, given when that audience's side last read the thread. */
export function projectMessage(
  message: MessageRecord,
  audience: 'applicant',
  readAt: Date | null,
): ApplicantMessage;
export function projectMessage(
  message: MessageRecord,
  audience: 'staff',
  readAt: Date | null,
): StaffMessage;
export function projectMessage(
  message: MessageRecord,
  audience: ProjectionAudience,
  readAt: Date | null,
): ApplicantMessage | StaffMessage | null;
export function projectMessage(
  message: MessageRecord,
  audience: ProjectionAudience,
  readAt: Date | null,
): ApplicantMessage | StaffMessage | null {
  if (audience !== 'applicant' && audience !== 'staff') return null;
  const view: ApplicantMessage = {
    id: message.id,
    side: message.side,
    body: message.body,
    sentAt: message.createdAt.toISOString(),
    unread: message.side !== audience && (readAt === null || message.createdAt > readAt),
  };
  if (audience === 'applicant') return view;
  return { ...view, authorName: message.side === 'staff' ? message.authorName : null };
}

/** A thread as `audience` sees it, read against its own side's last-read time. */
export function projectThread(thread: ThreadRecord, audience: 'applicant'): ApplicantThread;
export function projectThread(thread: ThreadRecord, audience: 'staff'): StaffThread;
export function projectThread(
  thread: ThreadRecord,
  audience: ProjectionAudience,
): ApplicantThread | StaffThread | null;
export function projectThread(
  thread: ThreadRecord,
  audience: ProjectionAudience,
): ApplicantThread | StaffThread | null {
  if (audience === 'applicant') {
    const messages = thread.messages.map((m) =>
      projectMessage(m, audience, thread.applicantReadAt),
    );
    return { messages, unreadCount: unread(messages) };
  }
  if (audience === 'staff') {
    const messages = thread.messages.map((m) => projectMessage(m, audience, thread.staffReadAt));
    return { messages, unreadCount: unread(messages) };
  }
  return null;
}

function unread(messages: readonly ApplicantMessage[]): number {
  return messages.filter((message) => message.unread).length;
}
