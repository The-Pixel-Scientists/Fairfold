// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Withholding and staff deletion (ADR 0030, "Rescans"). Both lock the file's
// row first (SELECT ... FOR UPDATE) and keep the lock until the request
// commits, which is what the sweep and the recheck rely on: a copy written
// here is either under a row they see or written after their delete. A
// withheld file is never destroyed here; its bytes move to withheld/ and
// the sweep removes the stale clean/ copy. Names never reach the audit event.

import { ApiError } from '../../problems.ts';
import { withheldKey, type Storage } from './storage.ts';
import type { FileRequest, FileTables } from './types.ts';

export const notFound = (reason: string): ApiError => new ApiError(404, undefined, { reason });

export interface Withheld {
  readonly id: string;
  /** The clean/ key and hash the bytes were read and scanned under. */
  readonly key: string;
  readonly hash: Buffer;
  readonly bytes: Uint8Array;
  /** clamd's signature version that found the match. */
  readonly version: number;
}

export async function withhold(
  scanner: Storage,
  request: FileRequest,
  { id, key, hash, bytes, version }: Withheld,
): Promise<void> {
  const db = request.tx.$extendTables<FileTables>();
  const locked = await db
    .selectFrom('app.file')
    .select(['storage_key', 'sha256'])
    .where('id', '=', id)
    .where('scan_state', '=', 'clean')
    .where('erased_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  // Changed or erased since the bytes were read: those bytes decide nothing.
  if (locked?.storage_key !== key || locked.sha256 === null || !locked.sha256.equals(hash)) {
    throw notFound('file_changed');
  }
  try {
    await scanner.put(withheldKey(request.tenant, id), bytes);
  } catch (error) {
    throw new ApiError(503, undefined, {
      cause: error,
      reason: 'storage_unavailable',
      headers: { 'retry-after': '5' },
    });
  }
  await db
    .updateTable('app.file')
    .set({
      scan_state: 'withheld',
      storage_key: withheldKey(request.tenant, id),
      scan_version: version,
      updated_by: request.membershipId,
    })
    .where('id', '=', id)
    .execute();
  await request.audit.record({
    action: 'platform.file.withheld',
    entityId: id,
    changes: {
      'app.file.scan_state': { before: 'clean', after: 'withheld' },
      'app.file.scan_version': { after: version },
    },
  });
}

export async function deleteWithheld(request: FileRequest, id: string): Promise<void> {
  const db = request.tx.$extendTables<FileTables>();
  const locked = await db
    .selectFrom('app.file')
    .select('id')
    .where('id', '=', id)
    .where('scan_state', '=', 'withheld')
    .where('erased_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (locked === undefined) throw notFound('file_not_found');
  await db
    .updateTable('app.file')
    .set({
      scan_state: 'infected',
      sha256: null,
      storage_key: null,
      updated_by: request.membershipId,
    })
    .where('id', '=', id)
    .execute();
  await request.audit.record({
    action: 'platform.file.deleted',
    entityId: id,
    changes: { 'app.file.scan_state': { before: 'withheld', after: 'infected' } },
  });
}
