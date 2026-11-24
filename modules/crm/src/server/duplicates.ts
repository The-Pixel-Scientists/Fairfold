// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Possible duplicates (ADR 0025): party's own candidates, listed as pairs
// with their signals and a strength band, never the values that matched. A
// pair is a suggestion; nothing here flags, blocks or merges anyone. The
// tenant list reads a page of parties and asks party for each one's
// candidates, keeping a pair only on the lower id's turn so it appears once.
// Pairs of people write `crm.duplicate.viewed` for each person in them.
// Staff dismiss a pair with a reason; a dismissed pair leaves both lists, and
// the dismissal stays as the record of what staff said. Nothing is merged or
// changed on a party by dismissing.

import type { DuplicateSignal, PartyKind } from '@pixel-scientists/party/contracts';

import {
  scoreBand,
  scoreBands,
  type DismissReason,
  type DuplicatePair,
} from '../contracts/index.ts';
import {
  crmDb,
  idCursor,
  iso,
  partyRequest,
  readIdCursor,
  type Args,
  type CrmContext,
  type CrmDependencies,
  type Tx,
} from './context.ts';

/** Parties asked about in one page of the tenant list. */
const SCANNED = 25;

const strongestFirst = (a: DuplicatePair, b: DuplicatePair) =>
  scoreBands.indexOf(a.band) - scoreBands.indexOf(b.band) ||
  a.partyId.localeCompare(b.partyId) ||
  a.otherPartyId.localeCompare(b.otherPartyId);

/** Parties a pair may be about: not merged away, and not erased. */
const OPEN: readonly string[] = ['active', 'archived'];

const COLUMNS = ['id', 'party_id', 'other_party_id', 'reason', 'created_at'] as const;

const toDismissal = (row: {
  id: string;
  party_id: string;
  other_party_id: string;
  reason: string;
  created_at: Date;
}) => ({
  id: row.id,
  partyId: row.party_id,
  otherPartyId: row.other_party_id,
  reason: row.reason as DismissReason,
  dismissedAt: iso(row.created_at),
});

const reasonsFor = (kind: PartyKind): readonly DismissReason[] =>
  kind === 'organisation'
    ? ['different_organisation', 'related_but_separate', 'duplicate_allowed']
    : ['different_person', 'related_but_separate', 'duplicate_allowed'];

const pairKey = ({ partyId, otherPartyId }: DuplicatePair) => `${partyId}:${otherPartyId}`;

export function duplicateHandlers(deps: CrmDependencies) {
  /** The pair in one form, the lower id first. */
  const pairOf = (
    id: string,
    other: string,
    kind: PartyKind,
    signals: readonly DuplicateSignal[],
  ): DuplicatePair => {
    const [partyId, otherPartyId] = id < other ? [id, other] : [other, id];
    return { partyId, otherPartyId, kind, signals: [...signals], band: scoreBand(signals) };
  };

  /** The pairs staff dismissed that involve any of these parties, by `pairKey`. */
  async function dismissedWith(tx: Tx, ids: readonly string[]): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const rows = await crmDb(tx)
      .selectFrom('crm.duplicate_dismissal')
      .select(['party_id', 'other_party_id'])
      .where((eb) => eb.or([eb('party_id', 'in', ids), eb('other_party_id', 'in', ids)]))
      .execute();
    return new Set(rows.map((row) => `${row.party_id}:${row.other_party_id}`));
  }

  async function audited(context: CrmContext, pairs: readonly DuplicatePair[]): Promise<void> {
    const people = new Set(
      pairs.filter(({ kind }) => kind === 'person').flatMap((p) => [p.partyId, p.otherPartyId]),
    );
    for (const id of [...people].sort()) {
      await context.audit.read({
        action: 'crm.duplicate.viewed',
        entityId: id,
        subjectPartyId: id,
      });
    }
  }

  async function listPartyDuplicates({
    tx,
    context,
    input,
  }: Args<{ params: { partyId: string } }>): Promise<{ pairs: DuplicatePair[] }> {
    const { partyId } = input.params;
    const [party] = await deps.parties.facts(tx, [partyId]);
    if (party === undefined) throw deps.notFound();
    const candidates = await deps.merges.duplicateCandidates(partyRequest(tx, context), partyId);
    const dismissed = await dismissedWith(tx, [partyId]);
    const pairs = candidates
      .map((c) => pairOf(partyId, c.partyId, party.kind, c.signals))
      .filter((pair) => !dismissed.has(pairKey(pair)))
      .sort(strongestFirst);
    await audited(context, pairs);
    return { pairs };
  }

  async function listDuplicates({
    tx,
    context,
    input,
  }: Args<{
    body: {
      kind?: PartyKind | undefined;
      signals?: readonly string[] | undefined;
      cursor?: string | undefined;
    };
  }>): Promise<{ pairs: DuplicatePair[]; nextCursor: string | null }> {
    const { kind, signals, cursor } = input.body;
    const scanned = await deps.parties.scan(tx, {
      kind,
      statuses: ['active', 'archived'],
      filters: [],
      afterId: readIdCursor(cursor, deps),
      limit: SCANNED + 1,
    });
    const pairs: DuplicatePair[] = [];
    for (const party of scanned.slice(0, SCANNED)) {
      const candidates = await deps.merges.duplicateCandidates(partyRequest(tx, context), party.id);
      for (const c of candidates) {
        if (party.id >= c.partyId) continue;
        if (signals !== undefined && !c.signals.some((s) => signals.includes(s))) continue;
        pairs.push(pairOf(party.id, c.partyId, party.kind, c.signals));
      }
    }
    const dismissed = await dismissedWith(
      tx,
      scanned.slice(0, SCANNED).map(({ id }) => id),
    );
    const listed = pairs.filter((pair) => !dismissed.has(pairKey(pair))).sort(strongestFirst);
    await audited(context, listed);
    const last = scanned[SCANNED - 1];
    return {
      pairs: listed,
      nextCursor: scanned.length > SCANNED && last !== undefined ? idCursor(last.id) : null,
    };
  }

  const readDismissal = (tx: Tx, id: string) =>
    crmDb(tx)
      .selectFrom('crm.duplicate_dismissal')
      .select(COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();

  async function dismissDuplicate({
    tx,
    context,
    input,
  }: Args<{ body: { partyId: string; otherPartyId: string; reason: DismissReason } }>) {
    const { reason } = input.body;
    const found = await deps.parties.facts(tx, [input.body.partyId, input.body.otherPartyId]);
    if (found.length !== 2 || found.some(({ status }) => !OPEN.includes(status))) {
      throw deps.notFound();
    }
    const [partyId, otherPartyId] = found.map(({ id }) => id).sort() as [string, string];
    const [kind, ...rest] = new Set(found.map((party) => party.kind));
    if (kind === undefined || rest.length > 0) {
      throw deps.refuse(400, 'Choose two organisations or two people, not one of each.');
    }
    if (!reasonsFor(kind).includes(reason)) {
      throw deps.refuse(400, 'Choose a reason that fits this kind of record.');
    }
    const db = crmDb(tx);
    const inserted = await db
      .insertInto('crm.duplicate_dismissal')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        kind,
        party_id: partyId,
        other_party_id: otherPartyId,
        reason,
        created_by: context.membership.id,
        updated_by: context.membership.id,
      }))
      .onConflict((oc) => oc.columns(['tenant_id', 'party_id', 'other_party_id']).doNothing())
      .returning(COLUMNS)
      .executeTakeFirst();
    if (inserted === undefined) {
      // A repeat answers the dismissal already held and changes nothing.
      const held = await db
        .selectFrom('crm.duplicate_dismissal')
        .select(COLUMNS)
        .where('party_id', '=', partyId)
        .where('other_party_id', '=', otherPartyId)
        .executeTakeFirstOrThrow();
      return toDismissal(held);
    }
    await context.audit.record({
      action: 'crm.duplicate.dismissed',
      entityId: inserted.id,
      subjectPartyId: partyId,
      changes: {
        'crm.duplicate_dismissal.kind': { after: kind },
        'crm.duplicate_dismissal.party_id': { after: partyId },
        'crm.duplicate_dismissal.other_party_id': { after: otherPartyId },
        'crm.duplicate_dismissal.reason': { after: reason },
      },
    });
    return toDismissal(inserted);
  }

  /** What a replay of `dismissDuplicate` answers: the dismissal as it reads now. */
  async function replayDismissal({ tx, id }: { tx: Tx; id: string }) {
    const row = await readDismissal(tx, id);
    if (row === undefined) throw deps.notFound();
    return toDismissal(row);
  }

  return { listDuplicates, listPartyDuplicates, dismissDuplicate, replayDismissal };
}
