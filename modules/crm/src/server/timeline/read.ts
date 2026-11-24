// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A party's timeline and staff's own notes on it (ADR 0017, ADR 0025). The
// timeline holds references: an item another module added names its source,
// and the screen reads it through that module, so no title, amount or outcome
// is copied here. An id from another tenant reads as a missing one. Every
// read writes `crm.timeline.viewed` with the party as the subject, since any
// timeline may hold staff's notes about a person. Recording an interaction
// stores the capped summary and the session's member, and audits ids and the
// kind only.

import {
  crmReadAudits,
  type Interaction,
  type InteractionInput,
  type TimelinePage,
} from '../../contracts/index.ts';
import {
  iso,
  nextCursor,
  PAGE,
  readCursor,
  type Args,
  type CrmDependencies,
  type Tx,
} from '../context.ts';
import { interactionDb } from './tables.ts';

const COLUMNS = [
  'id',
  'kind',
  'occurred_at',
  'source_module',
  'source_entity_type',
  'source_entity_id',
  'summary',
  'recorded_by',
] as const;

function toInteraction(row: {
  id: string;
  kind: string;
  occurred_at: Date;
  source_module: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  summary: string | null;
  recorded_by: string | null;
}): Interaction {
  const module = row.source_module as Interaction['module'];
  return {
    id: row.id,
    kind: row.kind as Interaction['kind'],
    occurredAt: iso(row.occurred_at),
    module,
    source:
      row.source_entity_type === null || row.source_entity_id === null
        ? null
        : { module, entityType: row.source_entity_type, entityId: row.source_entity_id },
    summary: row.summary,
    recordedBy: row.recorded_by,
  };
}

export function timelineHandlers(deps: CrmDependencies) {
  async function getTimeline({
    tx,
    context,
    input,
  }: Args<{
    params: { partyId: string };
    query: { cursor?: string | undefined };
  }>): Promise<TimelinePage> {
    const { partyId } = input.params;
    const offset = readCursor(input.query.cursor, deps);
    const [party] = await deps.parties.facts(tx, [partyId]);
    if (party === undefined) throw deps.notFound();
    await context.audit.read({
      action: crmReadAudits.getTimeline,
      entityId: partyId,
      subjectPartyId: partyId,
    });
    const rows = await interactionDb(tx)
      .selectFrom('crm.interaction')
      .select(COLUMNS)
      .where('party_id', '=', partyId)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .limit(PAGE + 1)
      .offset(offset)
      .execute();
    return {
      interactions: rows.slice(0, PAGE).map(toInteraction),
      nextCursor: nextCursor(offset, rows.length),
    };
  }

  async function recordInteraction({
    tx,
    context,
    input,
  }: Args<{ params: { partyId: string }; body: InteractionInput }>): Promise<Interaction> {
    const { partyId } = input.params;
    const { kind, occurredAt, summary } = input.body;
    const [party] = await deps.parties.facts(tx, [partyId]);
    if (party === undefined) throw deps.notFound();
    if (party.status === 'merged' || party.status === 'erased') {
      throw deps.refuse(
        409,
        'This record was merged or erased. Record the interaction on the record that was kept.',
      );
    }
    const row = await interactionDb(tx)
      .insertInto('crm.interaction')
      .values((eb) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        party_id: partyId,
        kind,
        occurred_at: new Date(occurredAt),
        source_module: 'crm',
        summary,
        recorded_by: context.membership.id,
      }))
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
    await context.audit.record({
      action: 'crm.interaction.recorded',
      entityId: row.id,
      subjectPartyId: partyId,
      changes: {
        'crm.interaction.party_id': { after: partyId },
        'crm.interaction.kind': { after: kind },
        'crm.interaction.summary': {},
      },
    });
    return toInteraction(row);
  }

  /** What a replay of `recordInteraction` answers: the item as it reads now, with no read audited. */
  async function replayInteraction({ tx, id }: { tx: Tx; id: string }): Promise<Interaction> {
    const row = await interactionDb(tx)
      .selectFrom('crm.interaction')
      .select(COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return toInteraction(row);
  }

  return { getTimeline, recordInteraction, replayInteraction };
}
