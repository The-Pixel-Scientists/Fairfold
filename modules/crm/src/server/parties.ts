// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What crm reads of party's records (ADR 0016, ADR 0017). crm never queries
// a party table: the platform passes in an implementation over party's server
// contract, in the request's transaction, so row-level security keeps every
// answer in the caller's tenant. Nothing here writes; every change to a party
// goes through party's merge contract.

import type { PartyKind, ValueHistoryField } from '@pixel-scientists/party/contracts';

import type { PartyStatus, SegmentFilter, VerificationState } from '../contracts/index.ts';
import type { Tx } from './context.ts';

export interface PartyFacts {
  readonly id: string;
  readonly kind: PartyKind;
  readonly status: PartyStatus;
}

export interface PartyQuery {
  /** Already normalised; matched as a name or email fragment, or an identifier. */
  readonly term: string;
  readonly kinds: readonly PartyKind[];
  readonly statuses: readonly PartyStatus[];
  readonly verification?: VerificationState | undefined;
  /** Only these parties, when set. */
  readonly among?: readonly string[] | undefined;
  readonly limit: number;
}

export interface FoundParty extends PartyFacts {
  /** An organisation's name, a person's full name or, with no name, their email. */
  readonly label: string;
  readonly verification: VerificationState;
  readonly mergedInto: string | null;
  /** How alike the name is to the term, for ordering: higher first. */
  readonly score: number;
}

/** The segment fields that party's own columns answer; crm answers the rest. */
export const partySegmentFields = [
  'kind',
  'status',
  'legal_form',
  'identifier_scheme',
  'contact_for',
  'created',
] as const;

export type PartySegmentField = (typeof partySegmentFields)[number];

export type PartyFilter = SegmentFilter & { readonly field: PartySegmentField };

export const isPartyFilter = (filter: SegmentFilter): filter is PartyFilter =>
  (partySegmentFields as readonly string[]).includes(filter.field);

export interface PartyScan {
  readonly kind?: PartyKind | undefined;
  readonly statuses?: readonly PartyStatus[] | undefined;
  readonly filters: readonly PartyFilter[];
  /** Parties after this id, in id order. */
  readonly afterId?: string | undefined;
  readonly limit: number;
}

export interface PartyReads {
  /** Kind and status of each party in the tenant; an id that is not there is left out. */
  facts(tx: Tx, ids: readonly string[]): Promise<readonly PartyFacts[]>;
  /** Best match first, at most `limit`, in the tenant only. */
  search(tx: Tx, query: PartyQuery): Promise<readonly FoundParty[]>;
  /** The party's values by field id, as party holds them; a field it has no value for is null. */
  values(
    tx: Tx,
    kind: PartyKind,
    id: string,
  ): Promise<ReadonlyMap<ValueHistoryField, string | null>>;
  /**
   * The current contact links a merge of two people would carry over, or null when party's rule
   * is that none are carried (either person has an account).
   */
  carriedLinks(
    tx: Tx,
    loserId: string,
    survivorId: string,
  ): Promise<
    readonly { readonly relationshipId: string; readonly organisationId: string }[] | null
  >;
  /** Parties that match every filter, in id order. */
  scan(
    tx: Tx,
    scan: PartyScan,
  ): Promise<readonly { readonly id: string; readonly kind: PartyKind }[]>;
}
