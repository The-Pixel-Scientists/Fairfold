// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Notes, messages and tags as the server holds them (ADR 0030): platform
// records with no owner or entity-type column. A module links each to its
// own records through its own join table with real foreign keys, such as
// grants' application notes and message threads. S12-13 classifies every
// column; bodies are personal, and ids, sides and times internal. Nothing
// here is ever sent as it is: projectNote() and projectThread() build what
// each audience sees.

import type { Id } from '../id.ts';

/** A member as the console names them: by display name, or null when they have none. */
export interface MemberName {
  readonly membershipId: Id;
  readonly name: string | null;
}

/** A staff note: append-only, so a correction is a new note. */
export interface NoteRecord {
  readonly id: Id;
  readonly body: string;
  readonly author: MemberName;
  /** Members the author chose to tell, checked against who may see the record when written. */
  readonly mentions: readonly MemberName[];
  readonly createdAt: Date;
}

/** Who wrote a message: the applicant, or staff writing as the funder. */
export const messageSides = ['applicant', 'staff'] as const;

export type MessageSide = (typeof messageSides)[number];

export interface MessageRecord {
  readonly id: Id;
  readonly threadId: Id;
  /** From the route's audience, never the request. */
  readonly side: MessageSide;
  readonly body: string;
  /** A membership id on the staff side, the applicant's party person id on theirs. */
  readonly authorId: Id;
  /** A staff author's display name; null for the applicant, whom staff know from the application. */
  readonly authorName: string | null;
  readonly createdAt: Date;
}

/**
 * One thread's messages, oldest first, and the last-read time on each side:
 * unread state is per side, not per member, and marking read on one side
 * changes nothing on the other.
 */
export interface ThreadRecord {
  readonly messages: readonly MessageRecord[];
  readonly applicantReadAt: Date | null;
  readonly staffReadAt: Date | null;
}

export interface TagRecord {
  readonly id: Id;
  readonly label: string;
}
