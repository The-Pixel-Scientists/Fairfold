// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ctx.files.send() (ADR 0047): a clean file of the caller's tenant, streamed
// from storage with the headers that stop a browser running it. The row is
// read under row-level security, so another tenant's file is a missing one,
// and so is a file that is not clean.

import { Readable } from 'node:stream';

import { idSchema } from '@pixel-scientists/domain';
import { fileTypes } from '@pixel-scientists/domain/files';

import { ApiError } from '../../problems.ts';
import type { Storage } from './storage.ts';
import type { FileReply, FileRequest, FileTables } from './types.ts';

const notFound = (reason: string): ApiError => new ApiError(404, undefined, { reason });

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

export async function sendFile(
  storage: Storage,
  request: FileRequest,
  fileId: string,
  options: { readonly audit: boolean },
): Promise<FileReply> {
  if (!idSchema.safeParse(fileId).success) throw notFound('file_not_found');
  const row = await request.tx
    .$extendTables<FileTables>()
    .selectFrom('app.file')
    .select(['name', 'content_type', 'size_bytes', 'storage_key'])
    .where('id', '=', fileId)
    .where('scan_state', '=', 'clean')
    .executeTakeFirst();
  const type = fileTypes.find((candidate) => candidate === row?.content_type);
  if (row === undefined || row.storage_key === null || type === undefined)
    throw notFound('file_not_found');

  const object = await storage.get(row.storage_key);
  if (object === null) throw notFound('object_missing');
  if (options.audit) {
    await request.audit.read({ action: 'platform.file.downloaded', entityId: fileId });
  }
  return {
    type,
    body: Readable.fromWeb(object),
    headers: {
      'content-disposition': contentDisposition(row.name),
      'content-length': row.size_bytes,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
    },
  };
}
