// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ctx.files.store() (ADR 0047), in the request's transaction. Size, name and
// type are checked before any row exists. Then a pending row is inserted, the
// bytes are scanned, and only a clean file is written to storage. The row
// ends in its final state in this transaction, with the audit event. If the
// commit fails after the object was written, the object has no row and is
// never sent; there is no clean-up path.

import { createHash } from 'node:crypto';

import {
  fileNameMatchesType,
  fileNameSchema,
  fileRefusalMessages,
  MAX_FILE_BYTES,
  sniffFileType,
  type FileRefusal,
} from '@pixel-scientists/domain/files';

import { ApiError } from '../../problems.ts';
import type { Verdict } from './clamd.ts';
import type { Storage } from './storage.ts';
import type { FileRequest, FileTables, StoreInput, StoreResult } from './types.ts';

export interface StoreDependencies {
  readonly storage: Storage;
  readonly scan: (bytes: Uint8Array) => Promise<Verdict>;
  /** Stores allowed at once in this process. */
  readonly maxStores: number;
}

/** What a refused scan is called to the person. */
const refusalFor: Record<Exclude<Verdict, 'clean'>, FileRefusal> = {
  infected: 'infected',
  error: 'not_checked',
};

export function createStore(deps: StoreDependencies) {
  let running = 0;

  return async function store(request: FileRequest, input: StoreInput): Promise<StoreResult> {
    const { bytes } = input;
    const name = fileNameSchema.safeParse(input.name);
    if (!name.success) {
      throw new ApiError(400, name.error.issues[0]?.message, { reason: 'bad_file_name' });
    }
    if (bytes.length > Math.min(input.maxBytes, MAX_FILE_BYTES)) return { refusal: 'too_large' };
    const type = sniffFileType(bytes);
    if (type === null || !input.allowedTypes.includes(type)) {
      return { refusal: 'type_not_allowed' };
    }
    if (!fileNameMatchesType(name.data, type)) return { refusal: 'wrong_extension' };

    if (running >= deps.maxStores) {
      throw new ApiError(503, fileRefusalMessages.scanner_busy, {
        reason: 'scanner_busy',
        headers: { 'retry-after': '5' },
      });
    }
    running++;
    try {
      const db = request.tx.$extendTables<FileTables>();
      const { id, created_at } = await db
        .insertInto('app.file')
        .values({
          tenant_id: request.tenant,
          name: name.data,
          content_type: type,
          size_bytes: bytes.length,
          created_by: request.membershipId,
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();

      const verdict = await deps.scan(bytes);
      const changes = {
        'app.file.content_type': { after: type },
        'app.file.size_bytes': { after: bytes.length },
        'app.file.scan_state': { after: verdict },
      };
      if (verdict !== 'clean') {
        await db
          .updateTable('app.file')
          .set({ scan_state: verdict })
          .where('id', '=', id)
          .execute();
        await request.audit.record({ action: 'platform.file.refused', entityId: id, changes });
        return { refusal: refusalFor[verdict] };
      }

      const key = `clean/${request.tenant}/${id}`;
      try {
        await deps.storage.put(key, bytes);
      } catch (error) {
        throw new ApiError(503, undefined, { cause: error, reason: 'storage_unavailable' });
      }
      await db
        .updateTable('app.file')
        .set({
          scan_state: 'clean',
          sha256: createHash('sha256').update(bytes).digest(),
          storage_key: key,
        })
        .where('id', '=', id)
        .execute();
      await request.audit.record({ action: 'platform.file.uploaded', entityId: id, changes });
      return {
        file: {
          id,
          name: name.data,
          type,
          bytes: bytes.length,
          uploadedAt: created_at.toISOString(),
        },
      };
    } finally {
      running--;
    }
  };
}
