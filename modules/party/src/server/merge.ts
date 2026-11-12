// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The merge executor (ADR 0025, architecture rule 9). Only a named staff
// action reaches it: crm's merge route, after its permission and step-up
// checks. It runs in the caller's tenant transaction and opens no other: the
// tenant is the transaction's and the deciding member is the session's, so
// neither is an argument. It refuses before it writes, calls every
// registered module's re-point whether or not the module is switched on, and
// leaves the loser `merged`, naming the survivor. The re-points run in a
// savepoint, so a refusal after some writes never leaves a half merge for the
// caller to commit, and any other failure undoes the merge and is thrown.

import { attempt } from '@pixel-scientists/db';
import type { Id } from '@pixel-scientists/domain';
import { moduleIds, modules, type ModuleId } from '@pixel-scientists/domain/platform';

import {
  countsByTable,
  mergeInputSchema,
  type MergeConflict,
  type MergeCounts,
  type MergeInput,
  type MergeOutcome,
  type PartyKind,
  type PartyMerges,
  type RepointParty,
  type ResolvedParty,
} from '../contracts/index.ts';
import { duplicateCandidates } from './duplicates.ts';
import type { PartyRequest } from './request.ts';
import { repointParty } from './repoint.ts';
import { partyDb, type Tx } from './tables.ts';

interface PartyRow {
  readonly id: string;
  readonly kind: PartyKind;
  readonly status: 'active' | 'archived' | 'merged' | 'erased';
}

/** The catalogue tables the check below reads. */
type Catalogue = {
  'pg_catalog.pg_constraint': { conrelid: number; confrelid: number; contype: string };
  'pg_catalog.pg_class': { oid: number; relnamespace: number; relname: string };
  'pg_catalog.pg_namespace': { oid: number; nspname: string };
};

/**
 * The modules whose tables hold a foreign key to a party table, read from the
 * catalogue so that a new reference cannot be forgotten. A schema no module
 * owns counts as a module that cannot register.
 */
async function modulesHoldingPartyKeys(tx: Tx): Promise<readonly (ModuleId | null)[]> {
  const rows = await tx
    .$extendTables<Catalogue>()
    .selectFrom('pg_catalog.pg_constraint as c')
    .innerJoin('pg_catalog.pg_class as holder', 'holder.oid', 'c.conrelid')
    .innerJoin('pg_catalog.pg_namespace as n', 'n.oid', 'holder.relnamespace')
    .innerJoin('pg_catalog.pg_class as target', 'target.oid', 'c.confrelid')
    .innerJoin('pg_catalog.pg_namespace as tn', 'tn.oid', 'target.relnamespace')
    .select('n.nspname as schema')
    .distinct()
    .where('c.contype', '=', 'f')
    .where('tn.nspname', '=', 'party')
    .where('target.relname', 'in', ['party', 'organisation', 'person'])
    .where('n.nspname', '<>', 'party')
    .execute();
  const owners = rows.map(
    ({ schema }) =>
      moduleIds.find((id) => modules[id].schemas.some((own) => own === schema)) ?? null,
  );
  return owners.filter((owner) => owner !== 'platform');
}

function refusal(loser: PartyRow, survivor: PartyRow, kind: PartyKind): MergeConflict | null {
  if (loser.kind !== kind || survivor.kind !== kind) return 'kind_mismatch';
  if (loser.status === 'erased' || survivor.status === 'erased') return 'party_erased';
  if (loser.status === 'merged' || survivor.status === 'merged') return 'party_merged';
  return survivor.status === 'active' ? null : 'survivor_not_active';
}

const refused = (conflict: MergeConflict): MergeOutcome => ({ merged: false, conflict });

/**
 * The executor over the registered re-points, party's own first. `notFound`
 * reads as a missing record, which is what a party of another tenant is.
 */
export function createPartyMerges({
  repoints,
  notFound,
}: {
  readonly repoints: readonly RepointParty<Tx>[];
  readonly notFound: () => Error;
}): PartyMerges<PartyRequest> {
  const ordered = [...repoints].sort(
    (a, b) => Number(b.module === 'party') - Number(a.module === 'party'),
  );

  /** Both parties, locked against every other change when `lock` is set, lower id first. */
  async function pair(tx: Tx, { loserId, survivorId }: MergeInput, lock: boolean) {
    const query = partyDb(tx)
      .selectFrom('party.party')
      .select(['id', 'kind', 'status'])
      .where('id', 'in', [loserId, survivorId])
      .orderBy('id');
    const rows = await (lock ? query.forUpdate() : query).execute();
    const loser = rows.find((row) => row.id === loserId);
    const survivor = rows.find((row) => row.id === survivorId);
    if (loser === undefined || survivor === undefined) throw notFound();
    return { loser, survivor };
  }

  async function mergeParties(
    { tx, audit, membership }: PartyRequest,
    request: MergeInput,
  ): Promise<MergeOutcome> {
    const input = mergeInputSchema.parse(request);
    const { loserId, survivorId, kind } = input;
    if (loserId === survivorId) return refused('self_merge');

    // Fail closed: a module holding party keys with no re-point blocks every merge.
    const registered = new Set<ModuleId | null>(repoints.map(({ module }) => module));
    if ((await modulesHoldingPartyKeys(tx)).some((owner) => !registered.has(owner))) {
      return refused('module_unregistered');
    }

    const seen = await pair(tx, input, false);
    const early = refusal(seen.loser, seen.survivor, kind);
    if (early !== null) return refused(early);
    const { loser, survivor } = await pair(tx, input, true);
    const late = refusal(loser, survivor, kind);
    if (late !== null) return refused(late);

    const counts: MergeCounts = {};
    const stopped: { conflict?: MergeConflict } = {};
    const done = await attempt(tx, async () => {
      for (const repoint of ordered) {
        const move = { loserId, survivorId, kind };
        const result =
          repoint.module === 'party'
            ? await repointParty(tx, move, membership.id)
            : await repoint.repoint(tx, move);
        if (!result.ok) {
          stopped.conflict = result.conflict;
          throw new Error('A module refused the merge.');
        }
        if (result.rows.length > 0) counts[repoint.module] = countsByTable(result.rows);
      }
      await partyDb(tx)
        .updateTable('party.party')
        .set({ status: 'merged', merged_into: survivorId, updated_by: membership.id })
        .where('id', '=', loserId)
        .execute();
    });
    if (!done) {
      if (stopped.conflict !== undefined) return refused(stopped.conflict);
      throw new Error('The merge failed and was undone.');
    }

    await audit.record({
      action: 'party.party.merged',
      entityId: loserId,
      changes: {
        'party.party.status': { before: loser.status, after: 'merged' },
        'party.party.merged_into': { after: survivorId },
      },
    });
    return { merged: true, counts };
  }

  async function resolveParty({ tx }: PartyRequest, partyId: Id): Promise<ResolvedParty | null> {
    const row = await partyDb(tx)
      .selectFrom('party.party')
      .select(['id', 'kind', 'merged_into'])
      .where('id', '=', partyId)
      .executeTakeFirst();
    if (row === undefined) return null;
    return {
      id: row.merged_into ?? row.id,
      kind: row.kind,
      reachedThroughMerge: row.merged_into !== null,
    };
  }

  return { mergeParties, duplicateCandidates, resolveParty };
}
