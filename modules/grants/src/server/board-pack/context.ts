// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the board pack handlers and job read from the platform (ADR 0016).
// The module never imports from the API: the API passes in the template
// versions, the queue and the renderer. The acting member comes from the
// session alone, never from a request.

import type { TemplateVersion } from '@pixel-scientists/domain/documents';
import type { Classification } from '@pixel-scientists/domain/forms';
import type { Permission } from '@pixel-scientists/domain/platform';

import type { GrantsDependencies } from '../programme/context.ts';
import type { Tx } from '../programme/tables.ts';
import type { ViewDependencies } from '../views/context.ts';
import type { BoardPackModel } from './sections.ts';

export interface BoardPackContext {
  readonly requestId: string;
  readonly session: { readonly tenant: string };
  readonly membership: { readonly id: string; readonly permissions: ReadonlySet<Permission> };
}

/** What the request writes for the job to trust (ADR 0009). */
export interface BoardPackRequest {
  /** Ids only: the applications and the pinned template version. */
  readonly filters: {
    readonly applicationIds: readonly string[];
    readonly templateVersionId: string;
  };
  readonly fieldIds: readonly string[];
  readonly answerClasses: Readonly<Record<string, Classification>>;
}

export interface BoardPackDependencies
  extends
    Pick<GrantsDependencies, 'notFound' | 'tenantTimeZone'>,
    Pick<ViewDependencies, 'forbidden'> {
  readonly boardPackTemplates: {
    /** The tenant's latest board pack version, publishing the built-in default first if there is none. */
    readonly latestOrDefault: (
      tx: Tx,
      author: { readonly membershipId: string; readonly requestId: string },
    ) => Promise<TemplateVersion>;
    readonly byId: (tx: Tx, id: string) => Promise<TemplateVersion | undefined>;
  };
  /**
   * Writes the job request and its `grants.board_pack.requested` event and
   * queues the job, in the request's transaction. Answers the request's id.
   */
  readonly queueBoardPack: (
    tx: Tx,
    by: { readonly membershipId: string; readonly requestId: string },
    request: BoardPackRequest,
  ) => Promise<string>;
}

/** What the job needs besides the transaction: the renderer and the output writer. */
export interface BoardPackJobDependencies extends Pick<
  BoardPackDependencies,
  'boardPackTemplates' | 'tenantTimeZone'
> {
  /** The PDF as a stream of pieces: S12-19's renderer behind the platform's model check. */
  readonly render: (model: BoardPackModel, createdAt: Date) => AsyncIterable<Uint8Array>;
  /**
   * Stores the stream as an `app.file` for the requester alone, classified as the most sensitive of
   * the fields rendered (S11-85), and answers its id.
   */
  readonly store: (
    tx: Tx,
    output: {
      readonly chunks: AsyncIterable<Uint8Array>;
      readonly fileName: string;
      readonly requesterId: string;
      readonly fieldIds: readonly string[];
      readonly answerClasses: Readonly<Record<string, Classification>>;
    },
  ) => Promise<string>;
}
