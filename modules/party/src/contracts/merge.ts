// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Duplicates and merging (ADR 0025). A merge is a named staff action: one
// loser and one survivor of the same kind. The loser stays, marked
// `merged`, and every module holding party keys re-points its working
// references in the same transaction, modules switched off included.
// Records of what happened (consent, value history, snapshots, merge
// records, audit events) keep the ids they were written with. The tenant
// and the deciding member come from the caller's context, never an input.

import { idSchema, type Id } from '@pixel-scientists/domain';
import { moduleIds, type ModuleId } from '@pixel-scientists/domain/platform';
import { z } from 'zod';

import { partyKindSchema, type PartyKind } from './lists.ts';

export const mergeInputSchema = z.strictObject({
  loserId: idSchema,
  survivorId: idSchema,
  kind: partyKindSchema,
});

export type MergeInput = z.infer<typeof mergeInputSchema>;

/** Why a merge, or its reversal, is refused before anything is written. */
export const mergeConflicts = [
  /** The loser and the survivor are the same party. */
  'self_merge',
  'kind_mismatch',
  /** Either party is already merged: no chains. */
  'party_merged',
  'party_erased',
  'survivor_not_active',
  /** Both people are linked to accounts. */
  'both_have_accounts',
  /** Only the loser is linked to an account; it must be the survivor. */
  'account_on_loser',
  /** The same scheme with different values, both verified. */
  'identifiers_both_verified',
  /** The same scheme with different values, only the loser's verified. */
  'loser_identifier_verified',
  /** A module cannot re-point without breaking one of its own constraints. */
  'module_refused',
  /** A party key holding module has no re-point registered. */
  'module_unregistered',
  /** On reversal: a row the merge moved no longer points at the survivor. */
  'rows_changed',
] as const;

export type MergeConflict = (typeof mergeConflicts)[number];

export const mergeConflictSchema = z.enum(mergeConflicts);

/** What a re-point did to one row. */
export const repointChanges = [
  'repointed',
  'link_added',
  'link_ended',
  'verification_moved',
  'merged_into_moved',
] as const;

export type RepointChange = (typeof repointChanges)[number];

export interface RepointRow {
  /** `<schema>.<table>`, such as `grants.application`. */
  readonly table: string;
  readonly rowId: Id;
  readonly change: RepointChange;
}

/** Ids and the party kind only: no tenant, which comes from the transaction. */
export interface RepointInput {
  readonly loserId: Id;
  readonly survivorId: Id;
  readonly kind: PartyKind;
}

/** A reversal moves back exactly the rows the merge recorded for the module. */
export interface RestoreInput extends RepointInput {
  readonly rows: readonly RepointRow[];
}

export type RepointResult =
  | { readonly ok: true; readonly rows: readonly RepointRow[] }
  | { readonly ok: false; readonly conflict: MergeConflict };

/** What each module holding party keys implements, in the merge's own transaction `Tx`. */
export interface RepointParty<Tx> {
  readonly module: ModuleId;
  repoint(tx: Tx, input: RepointInput): Promise<RepointResult>;
  restore(tx: Tx, input: RestoreInput): Promise<RepointResult>;
}

/**
 * The re-points the merge executor calls, every one on every merge whether
 * or not the module is switched on. Refuses a module twice, a list without
 * party's own, or a module that does not exist.
 */
export function registerRepoints<Tx>(
  repoints: readonly RepointParty<Tx>[],
): readonly RepointParty<Tx>[] {
  const modules = repoints.map((repoint) => repoint.module);
  if (new Set(modules).size !== modules.length) {
    throw new Error('A module registers its party re-point once.');
  }
  if (!modules.includes('party')) throw new Error("Party's own re-point must be registered.");
  if (!modules.every((module) => moduleIds.includes(module))) {
    throw new Error('A party re-point names a module that does not exist.');
  }
  return Object.freeze([...repoints]);
}

/** Rows changed in each table, from a module's result. */
export function countsByTable(rows: readonly RepointRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { table } of rows) counts[table] = (counts[table] ?? 0) + 1;
  return counts;
}

const TABLE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** Rows changed by table, for each module that changed any. */
export const mergeCountsSchema = z.partialRecord(
  z.enum(moduleIds),
  z.record(z.string().regex(TABLE), z.int().nonnegative()),
);

export type MergeCounts = z.infer<typeof mergeCountsSchema>;

export type MergeOutcome =
  | { readonly merged: true; readonly counts: MergeCounts }
  | { readonly merged: false; readonly conflict: MergeConflict };

/** What raised a duplicate candidate. The first four are for organisations, the last two for people. */
export const duplicateSignals = [
  'verified_identifier',
  'claimed_identifier',
  'name',
  'name_and_postcode',
  'email',
  'name_and_organisation',
] as const;

export type DuplicateSignal = (typeof duplicateSignals)[number];

/** Trigram similarity each name signal needs (ADR 0025), passed to SQL as parameters. */
export const duplicateThresholds = {
  name: 0.6,
  nameAndPostcode: 0.4,
  nameAndOrganisation: 0.6,
} as const;

/** A suggestion for staff, never an action: nothing links, merges or flags anyone. */
export const duplicateCandidateSchema = z.strictObject({
  partyId: idSchema,
  signals: z.array(z.enum(duplicateSignals)).min(1),
});

export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

/** A party id followed through a merge. Module code never follows `merged_into` itself. */
export interface ResolvedParty {
  readonly id: Id;
  readonly kind: PartyKind;
  /** The id asked for was merged into this one. */
  readonly reachedThroughMerge: boolean;
}

/**
 * The party server's merge contract, for crm's staff routes only. `Ctx` is
 * the caller's request context: the tenant transaction and the session.
 */
export interface PartyMerges<Ctx> {
  mergeParties(ctx: Ctx, input: MergeInput): Promise<MergeOutcome>;
  /** Staff only; a person's candidates are a sensitive read. Merged and erased parties are never candidates. */
  duplicateCandidates(ctx: Ctx, partyId: Id): Promise<readonly DuplicateCandidate[]>;
  /** Null for an id not in the tenant. */
  resolveParty(ctx: Ctx, partyId: Id): Promise<ResolvedParty | null>;
}
