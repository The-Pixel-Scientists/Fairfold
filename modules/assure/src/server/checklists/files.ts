// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Files an answer or a visit links (ADR 0030). The database links a file
// when its join row is added and releases it when the row goes; this checks
// first, so the caller is told which kind of file to choose rather than
// that a rule refused. A file is ready when it is in the caller's tenant,
// has passed its virus scan, is not erased and was never linked.

import type { AssureDb } from './context.ts';

export const FILES_NOT_READY =
  'Choose files that have finished their virus check and are not used anywhere else.';

/** Whether every file is ready to link, locking them so none changes before the link. */
export async function filesReady(db: AssureDb, fileIds: readonly string[]): Promise<boolean> {
  if (fileIds.length === 0) return true;
  const ready = await db
    .selectFrom('app.file')
    .select('id')
    .where('id', 'in', [...fileIds])
    .where('scan_state', '=', 'clean')
    .where('linked_at', 'is', null)
    .where('erased_at', 'is', null)
    .forUpdate()
    .execute();
  return ready.length === new Set(fileIds).size;
}
