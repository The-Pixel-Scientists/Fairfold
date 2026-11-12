// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An application's thread: one per application, made with its first message.
// The platform holds the thread and its messages; grants holds the link.

import type { NotesPlatform } from '../notes/context.ts';
import { noteDb } from '../notes/tables.ts';
import type { Tx } from '../programme/tables.ts';

export async function threadOf(tx: Tx, applicationId: string): Promise<string | undefined> {
  const link = await noteDb(tx)
    .selectFrom('grants.application_message')
    .select('thread_id')
    .where('application_id', '=', applicationId)
    .executeTakeFirst();
  return link?.thread_id;
}

/**
 * The application's thread, made and linked if it has none. The caller holds the application's
 * row lock (submittedApplication with `lock`), so a second first message waits, then finds the
 * thread the first one made.
 */
export async function ensureThread(
  tx: Tx,
  notes: Pick<NotesPlatform, 'addThread'>,
  applicationId: string,
): Promise<string> {
  const existing = await threadOf(tx, applicationId);
  if (existing !== undefined) return existing;
  const threadId = await notes.addThread(tx);
  await noteDb(tx)
    .insertInto('grants.application_message')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      application_id: applicationId,
      thread_id: threadId,
    }))
    .execute();
  return threadId;
}
