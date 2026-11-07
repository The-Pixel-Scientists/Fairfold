// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ctx.files.send() (ADR 0047, ADR 0030): a clean file of the caller's tenant.
// The row is read under row-level security, so another tenant's file is a
// missing one, and so is a file that is not clean. The bytes are read whole
// (10 MiB at most) and must match the row's SHA-256 before anything is sent.
// If clamd's signatures are newer than the file's last scan, the bytes are
// scanned again first: a clean result is recorded, a match withholds the
// file, and a scanner that cannot answer is a 503 that sends nothing.

import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

import { idSchema } from '@pixel-scientists/domain';
import { fileTypes, needsRescan } from '@pixel-scientists/domain/files';

import { ApiError } from '../../problems.ts';
import type { Verdict } from './clamd.ts';
import type { Slots } from './slots.ts';
import { readAll, type Storage } from './storage.ts';
import type { FileReply, FileRequest, FileTables } from './types.ts';
import { notFound, withhold } from './withhold.ts';

/** RFC 5987 `attr-char`: what may stay as it is in `filename*`. */
const encodeValue = (name: string): string =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * `attachment` with the name as RFC 6266 `filename*`, and an ASCII fallback
 * for old clients that drops quotes, backslashes and control characters and
 * replaces anything else outside printable ASCII.
 */
export function contentDisposition(name: string): string {
  const fallback = name.replace(/["\\\p{Cc}]/gu, '').replace(/[^\x20-\x7e]/gu, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeValue(name)}`;
}

export interface SendDependencies {
  /** The read key: `clean/` objects. */
  readonly storage: Storage;
  /** The scanner key: writes the `withheld/` copy. */
  readonly scanner: Storage;
  readonly scan: (bytes: Uint8Array) => Promise<Verdict>;
  /** clamd's signature version, kept for a minute, or null if it cannot say. */
  readonly version: () => Promise<number | null>;
  readonly slots: Slots;
}

/** Whether the bytes hash to the stored SHA-256. */
const sameHash = (bytes: Uint8Array, hash: Buffer): boolean =>
  timingSafeEqual(createHash('sha256').update(bytes).digest(), hash);

const unavailable = (reason: string): ApiError =>
  new ApiError(503, undefined, { reason, headers: { 'retry-after': '5' } });

export async function sendFile(
  deps: SendDependencies,
  request: FileRequest,
  fileId: string,
  options: { readonly audit: boolean },
): Promise<FileReply> {
  if (!idSchema.safeParse(fileId).success) throw notFound('file_not_found');
  const db = request.tx.$extendTables<FileTables>();
  const row = await db
    .selectFrom('app.file')
    .select(['name', 'content_type', 'size_bytes', 'storage_key', 'sha256', 'scan_version'])
    .where('id', '=', fileId)
    .where('scan_state', '=', 'clean')
    .where('erased_at', 'is', null)
    .executeTakeFirst();
  const type = fileTypes.find((candidate) => candidate === row?.content_type);
  if (row === undefined || row.storage_key === null || row.sha256 === null || type === undefined) {
    throw notFound('file_not_found');
  }

  const object = await deps.storage.get(row.storage_key);
  if (object === null) throw notFound('object_missing');
  const bytes = await readAll(object, Number(row.size_bytes));
  if (bytes === null || !sameHash(bytes, row.sha256)) throw notFound('object_changed');

  const version = await deps.version();
  if (version === null) throw unavailable('scanner_unavailable');
  if (needsRescan(row.scan_version, version)) {
    const verdict = await deps.slots.run(() => deps.scan(bytes));
    if (verdict === 'error') throw unavailable('scanner_unavailable');
    if (verdict === 'infected') {
      await withhold(deps.scanner, request, {
        id: fileId,
        key: row.storage_key,
        hash: row.sha256,
        bytes,
        version,
      });
      // Answered after the commit, so the withheld state and its event are kept.
      request.afterCommit(() => Promise.reject(notFound('file_withheld')));
      return undefined as never;
    }
    await db
      .updateTable('app.file')
      .set({ scan_version: version, updated_by: request.membershipId })
      .where('id', '=', fileId)
      .where('scan_state', '=', 'clean')
      .where((eb) => eb.or([eb('scan_version', 'is', null), eb('scan_version', '<', version)]))
      .execute();
  }

  if (options.audit) {
    await request.audit.read({ action: 'platform.file.downloaded', entityId: fileId });
  }
  return {
    type,
    body: Readable.from(bytes),
    headers: {
      'content-disposition': contentDisposition(row.name),
      'content-length': row.size_bytes,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
    },
  };
}
