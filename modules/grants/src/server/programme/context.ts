// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the grants handlers read from the platform (ADR 0016). The module
// never imports from the API: the API passes in what a handler needs from
// the request and from the platform's own tables.

import type { AuditChanges } from '@pixel-scientists/db';
import type { FieldProblem } from '@pixel-scientists/domain/platform';

import type {
  ConfigDiff,
  GrantsAuditAction,
  GrantsConfigEntityType,
} from '../../contracts/index.ts';
import type { Tx } from './tables.ts';

/** What a handler reads from the request context. */
export interface GrantsContext {
  readonly audit: {
    record(event: {
      readonly action: GrantsAuditAction;
      readonly entityId: string;
      readonly changes?: AuditChanges;
    }): Promise<void>;
  };
  readonly session: { readonly tenant: string };
  readonly membership: { readonly id: string };
}

/** One saved version of an object's configuration, with the account of its author. */
export interface ConfigHistoryRow {
  readonly version: number;
  readonly createdAt: Date;
  readonly authorId: string;
  readonly authorUserId: string;
  readonly diff: unknown;
}

/** What the platform passes in. */
export interface GrantsDependencies {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A failure the caller can fix, in plain words, with the fields at fault. */
  readonly refuse: (status: 400 | 409, detail: string, errors?: readonly FieldProblem[]) => Error;
  readonly tenantTimeZone: (tx: Tx, tenant: string) => Promise<string>;
  /** Writes the entity's next configuration version (rule 10) in the request's transaction. */
  readonly recordConfig: (
    tx: Tx,
    authorId: string,
    entityType: GrantsConfigEntityType,
    entityId: string,
    diff: ConfigDiff,
  ) => Promise<void>;
  readonly configHistory: (
    tx: Tx,
    entityType: GrantsConfigEntityType,
    entityId: string,
  ) => Promise<readonly ConfigHistoryRow[]>;
}

export interface ProgrammeParams {
  readonly params: { readonly programmeId: string };
}

export interface RoundParams {
  readonly params: { readonly roundId: string };
}

export interface Args<I> {
  readonly tx: Tx;
  readonly context: GrantsContext;
  readonly input: I;
}
