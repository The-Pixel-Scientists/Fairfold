// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Possible duplicates (ADR 0025): party's own candidates, listed as pairs
// with their signals and a strength band, never the values that matched. A
// pair is a suggestion; nothing here flags, blocks or merges anyone. The
// tenant list reads a page of parties and asks party for each one's
// candidates, keeping a pair only on the lower id's turn so it appears once.
// Pairs of people write `crm.duplicate.viewed` for each person in them.

import type { DuplicateSignal, PartyKind } from '@pixel-scientists/party/contracts';

import { scoreBand, scoreBands, type DuplicatePair } from '../contracts/index.ts';
import {
  idCursor,
  partyRequest,
  readIdCursor,
  type Args,
  type CrmContext,
  type CrmDependencies,
} from './context.ts';

/** Parties asked about in one page of the tenant list. */
const SCANNED = 25;

const strongestFirst = (a: DuplicatePair, b: DuplicatePair) =>
  scoreBands.indexOf(a.band) - scoreBands.indexOf(b.band) ||
  a.partyId.localeCompare(b.partyId) ||
  a.otherPartyId.localeCompare(b.otherPartyId);

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
    const pairs = candidates
      .map((c) => pairOf(partyId, c.partyId, party.kind, c.signals))
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
    pairs.sort(strongestFirst);
    await audited(context, pairs);
    const last = scanned[SCANNED - 1];
    return {
      pairs,
      nextCursor: scanned.length > SCANNED && last !== undefined ? idCursor(last.id) : null,
    };
  }

  return { listDuplicates, listPartyDuplicates };
}
