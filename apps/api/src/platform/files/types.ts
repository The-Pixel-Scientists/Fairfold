// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a handler sees of the file service (ADR 0047), and the rows it reads.

import type { Readable } from 'node:stream';

import type { FileRefusal, FileType, FileView } from '@pixel-scientists/domain/files';

import type { RequestAudit } from '../../context.ts';
import type { TenantTransaction } from '../../database.ts';

export interface StoreInput {
  /** The name the person chose, from the `File-Name` header. Checked again here. */
  readonly name: string;
  readonly bytes: Uint8Array;
  /** The types this record takes. A file of another type is refused. */
  readonly allowedTypes: readonly FileType[];
  /** At most the platform's 10 MiB. */
  readonly maxBytes: number;
}

/** A clean, stored file, or the reason it was not taken. */
export type StoreResult = { readonly file: FileView } | { readonly refusal: FileRefusal };

/** A raw route's answer: the file's bytes, streamed, with the headers that stop a browser running it. */
export interface FileReply {
  readonly type: FileType;
  readonly body: Readable;
  readonly headers: Readonly<Record<string, string>>;
}

export interface RequestFiles {
  /** Checks, scans and stores a file in the request's transaction. Throws a 503 when too many stores run. */
  store(input: StoreInput): Promise<StoreResult>;
  /**
   * A clean file of the caller's tenant, as a raw answer. A missing, unclean
   * or other tenant's file is a 404. With `audit`, writes the staff download event.
   */
  send(fileId: string, options: { readonly audit: boolean }): Promise<FileReply>;
}

/** What the service needs of the request it serves. */
export interface FileRequest {
  readonly tx: TenantTransaction;
  readonly tenant: string;
  /** The acting membership: who created the file. */
  readonly membershipId: string;
  readonly audit: RequestAudit;
}

/** The service: binds the file operations to one request. */
export type FileService = (request: FileRequest) => RequestFiles;

type Column<S, I = S> = { readonly __select__: S; readonly __insert__: I; readonly __update__: S };

/** app.file (migration 0008) as app_api may reach it. */
export type FileTables = {
  'app.file': {
    tenant_id: string;
    id: Column<string, string | undefined>;
    name: string;
    content_type: string;
    size_bytes: Column<string, number>;
    sha256: Buffer | null;
    storage_key: string | null;
    scan_state: Column<string, undefined>;
    created_by: string;
    created_at: Column<Date, undefined>;
  };
};
