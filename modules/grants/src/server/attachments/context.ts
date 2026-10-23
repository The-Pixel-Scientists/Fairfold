// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the attachment handlers read from the platform (ADR 0016, ADR 0047).
// The platform has already checked the session, the permission and the scope
// rule. The acting person comes from the session alone, never from a request.

import type { FileRefusal, FileType, FileView } from '@pixel-scientists/domain/files';

import type { Tx } from '../programme/tables.ts';

/** What a handler reads from the request context. */
export interface AttachmentContext {
  readonly session: { readonly userId: string };
  readonly membership: { readonly id: string };
  /** The file service, bound to the request's transaction. */
  readonly files: {
    store(input: {
      readonly name: string;
      readonly bytes: Uint8Array;
      readonly allowedTypes: readonly FileType[];
      readonly maxBytes: number;
    }): Promise<{ readonly file: FileView } | { readonly refusal: FileRefusal }>;
    send(
      fileId: string,
      options: { readonly audit: boolean },
    ): Promise<{
      readonly type: FileType;
      readonly body: NodeJS.ReadableStream;
      readonly headers: Readonly<Record<string, string>>;
    }>;
  };
  /** Runs `work` once the request's transaction has committed; a failure there answers the request. */
  afterCommit(work: () => Promise<void>): void;
}

export interface AttachmentArgs<I> {
  readonly tx: Tx;
  readonly context: AttachmentContext;
  readonly input: I;
}
