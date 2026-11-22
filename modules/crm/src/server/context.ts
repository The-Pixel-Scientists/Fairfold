// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the crm handlers read from the platform (ADR 0016). The module never
// imports from the API: the API passes in what a handler needs from the
// request and from other modules. crm owns the crm tables only: it reads
// party through `PartyReads` and changes a party only through party's merge
// contract.

import type { PartyAuditAction, PartyKind, PartyMerges } from '@pixel-scientists/party/contracts';
import type { PartyRequest } from '@pixel-scientists/party/server';

import type { CrmAuditAction, SegmentChange } from '../contracts/index.ts';
import type { PartyReads } from './parties.ts';

/** The caller's request transaction, which already has its tenant set. */
export type Tx = PartyRequest['tx'];

/** A column the database fills in, so an insert may leave it out (kysely's `Generated`). */
type Generated<T> = {
  readonly __select__: T;
  readonly __insert__: T | undefined;
  readonly __update__: T;
};

type Tables = {
  'crm.list': {
    tenant_id: string;
    id: Generated<string>;
    name: string;
    description: string | null;
    archived_at: Date | string | null;
    updated_at: Generated<Date>;
    created_by: string;
    updated_by: string;
  };
  'crm.list_member': {
    tenant_id: string;
    id: Generated<string>;
    list_id: string;
    party_id: string;
    added_by: string;
    created_at: Generated<Date>;
  };
  'crm.segment': {
    tenant_id: string;
    id: Generated<string>;
    name: string;
    description: string | null;
    definition: unknown;
    version: Generated<number>;
    archived_at: Date | string | null;
    updated_at: Generated<Date>;
    created_by: string;
    updated_by: string;
  };
  'crm.interaction': {
    tenant_id: string;
    id: Generated<string>;
    party_id: string;
    kind: string;
    occurred_at: Date;
    source_module: string;
    source_entity_type: string | null;
    source_entity_id: string | null;
  };
  'crm.external_reference': {
    tenant_id: string;
    id: Generated<string>;
    party_id: string;
    system: string;
    external_id: string;
    url: string | null;
    created_at: Generated<Date>;
  };
  'crm.merge_record': {
    tenant_id: string;
    id: Generated<string>;
    kind: PartyKind;
    action: 'merge';
    loser_id: string;
    survivor_id: string;
    repointed_counts: unknown;
    preview_hash: string;
    merged_by: string;
    merged_at: Generated<Date>;
  };
};

/** The transaction typed to the tables crm uses. */
export function crmDb(tx: Tx) {
  return tx.$extendTables<Tables>();
}

export type CrmDb = ReturnType<typeof crmDb>;

type Action = CrmAuditAction | PartyAuditAction;

/** Field ids a change touched, with a value only where the field's class lets the audit log keep one. */
export type AuditChanges = Readonly<Record<string, { before?: unknown; after?: unknown }>>;

/** What a handler reads from the request context. */
export interface CrmContext {
  readonly audit: {
    record(event: {
      readonly action: Action;
      readonly entityId: string;
      readonly changes?: AuditChanges;
      readonly subjectPartyId?: string;
    }): Promise<void>;
    read(entity: {
      readonly action: Action;
      readonly entityId: string;
      readonly subjectPartyId?: string;
    }): Promise<void>;
  };
  /** Writes the segment's next configuration version (rule 10) in the request's transaction. */
  readonly config: {
    record(entityType: 'crm.segment', entityId: string, diff: SegmentChange[]): Promise<void>;
  };
  readonly session: {
    readonly userId: string;
    readonly tenant: string;
    readonly email: () => Promise<string>;
  };
  readonly membership: { readonly id: string };
}

/** What the platform passes in. */
export interface CrmDependencies {
  /** A failure that reads exactly as a missing record does. */
  readonly notFound: () => Error;
  /** A failure the caller can fix, in plain words that show nothing they sent. */
  readonly refuse: (status: 400 | 409, detail: string) => Error;
  /** What crm reads of party's records. */
  readonly parties: PartyReads;
  /** Party's merge contract, over every module's registered re-point (ADR 0025). */
  readonly merges: PartyMerges<PartyRequest>;
  /**
   * Runs `work` in a savepoint and reports whether it finished, undoing it if it threw: the db
   * package's `attempt`, which this module may not import.
   */
  readonly attempt: (tx: Tx, work: () => Promise<void>) => Promise<boolean>;
  /** The server's HMAC-SHA-256, with a secret of its own, for merge preview tokens. */
  readonly signPreview: (text: string) => string;
  /** SHA-256 of a text, in lower-case hex, for the merge record's preview hash. */
  readonly digest: (text: string) => string;
  /** Seconds since the epoch; the clock tests move. */
  readonly now?: () => number;
}

export interface Args<I> {
  readonly tx: Tx;
  readonly context: CrmContext;
  readonly input: I;
}

/** What party's merge contract runs in: the request's transaction and the session's member. */
export const partyRequest = (tx: Tx, { audit, membership }: CrmContext): PartyRequest => ({
  tx,
  audit,
  membership,
});

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/** Whether a statement failed because a row like it is already there. */
export function isTaken(error: unknown): boolean {
  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** Whether a statement failed a check or trigger rule the server could not foresee, such as a lost race. */
export function isRefusedByRule(error: unknown): boolean {
  return (error as { code?: unknown }).code === CHECK_VIOLATION;
}

export const iso = (time: Date | string): string => new Date(time).toISOString();

/** Rows in a page of every crm list. The contract's `PAGE_SIZE` is the same number. */
export const PAGE = 50;

/** Pages are read by offset; the cursor is the offset, in base64url, and carries no value. */
export function readCursor(cursor: string | undefined, deps: CrmDependencies): number {
  if (cursor === undefined) return 0;
  const text = Buffer.from(cursor, 'base64url').toString();
  if (!/^\d{1,6}$/.test(text)) {
    throw deps.refuse(400, 'This page link is not valid. Go back to the first page.');
  }
  return Number(text);
}

/** The cursor of the page after `offset`, or null when `rows` held no more than a page. */
export function nextCursor(offset: number, rows: number, size = PAGE): string | null {
  return rows > size ? Buffer.from(String(offset + size)).toString('base64url') : null;
}

/** A cursor over rows in id order is the last id returned, as base64url, and carries no value. */
export const idCursor = (id: string): string =>
  Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url');

/** The id a cursor names, or undefined for the first page. */
export function readIdCursor(
  cursor: string | undefined,
  deps: CrmDependencies,
): string | undefined {
  if (cursor === undefined) return undefined;
  const hex = Buffer.from(cursor, 'base64url').toString('hex');
  if (hex.length !== 32 || idCursor(hex) !== cursor) {
    throw deps.refuse(400, 'This page link is not valid. Go back to the first page.');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
