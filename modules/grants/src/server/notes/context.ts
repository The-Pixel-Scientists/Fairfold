// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the note and message handlers read from the platform (ADR 0016,
// ADR 0030). The platform has already checked the session, the permission
// and the scope rule. The author is the session's member or person, never a
// request's.

import type { AuditChanges } from '@pixel-scientists/db';
import type {
  MemberName,
  MessageSide,
  NoteRecord,
  ThreadRecord,
} from '@pixel-scientists/domain/notes';
import type { Permission } from '@pixel-scientists/domain/platform';

import type { GrantsAuditAction } from '../../contracts/index.ts';
import type { GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';

/**
 * The platform's note and message records (ADR 0030), which grants links to its
 * applications through its own tables. Each call runs in the request's transaction.
 */
export interface NotesPlatform {
  /** The active members holding `permission`, by name, read now in the request's tenant. */
  mentionable(tx: Tx, permission: Permission): Promise<MemberName[]>;
  /** Writes a note and its mentions, and answers its id. The caller checked the mentions. */
  addNote(
    tx: Tx,
    note: { authorId: string; body: string; mentions: readonly string[] },
  ): Promise<string>;
  /** These notes, newest first. */
  readNotes(tx: Tx, noteIds: readonly string[]): Promise<NoteRecord[]>;
  addThread(tx: Tx): Promise<string>;
  addMessage(
    tx: Tx,
    message: { threadId: string; side: MessageSide; body: string; authorId: string },
  ): Promise<string>;
  readThread(tx: Tx, threadId: string): Promise<ThreadRecord>;
  markRead(tx: Tx, threadId: string, side: MessageSide): Promise<void>;
}

export interface NoteDependencies extends Pick<GrantsDependencies, 'notFound' | 'refuse'> {
  readonly notes: NotesPlatform;
}

/** What a handler reads from the request context. */
export interface NoteContext {
  readonly requestId: string;
  readonly audit: {
    record(event: {
      readonly action: GrantsAuditAction;
      readonly entityId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
    /** Records a sensitive read. */
    read(event: { readonly action: GrantsAuditAction; readonly entityId: string }): Promise<void>;
  };
  readonly session: { readonly userId: string };
  readonly membership: { readonly id: string };
}

export interface NoteArgs<I> {
  readonly tx: Tx;
  readonly context: NoteContext;
  readonly input: I;
}
