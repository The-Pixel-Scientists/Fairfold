// SPDX-License-Identifier: AGPL-3.0-or-later
//
// External references (ADR 0008, ADR 0017): the id an organisation or person
// has in another system. A reference is a pointer only and never changes the
// party. The party is checked through party's read contract in the caller's
// tenant, so another tenant's party reads as not found; a merged or erased
// party takes no new reference. Each change writes its audit event with ids
// and the system only: the external id and address are personal, so the log
// names the fields and holds no value. Listing them is a sensitive read and
// writes `crm.party.viewed`, as the party's record does.

import type { ExternalReference, ExternalReferenceInput } from '../contracts/index.ts';
import { crmDb, iso, isTaken, type Args, type CrmDependencies, type Tx } from './context.ts';

const taken = 'This system and id are already recorded on a record. Check the id.';

const COLUMNS = ['id', 'system', 'external_id', 'url', 'created_at'] as const;

const toReference = (row: {
  id: string;
  system: string;
  external_id: string;
  url: string | null;
  created_at: Date;
}) =>
  ({
    id: row.id,
    system: row.system,
    externalId: row.external_id,
    url: row.url,
    addedAt: iso(row.created_at),
  }) as ExternalReference;

export function referenceHandlers(deps: CrmDependencies) {
  async function party(tx: Tx, partyId: string, statuses: readonly string[]): Promise<void> {
    const [found] = await deps.parties.facts(tx, [partyId]);
    if (found === undefined || !statuses.includes(found.status)) throw deps.notFound();
  }

  async function listExternalReferences({
    tx,
    context,
    input,
  }: Args<{ params: { partyId: string } }>): Promise<{ references: ExternalReference[] }> {
    const { partyId } = input.params;
    await party(tx, partyId, ['active', 'archived', 'merged']);
    await context.audit.read({
      action: 'crm.party.viewed',
      entityId: partyId,
      subjectPartyId: partyId,
    });
    const rows = await crmDb(tx)
      .selectFrom('crm.external_reference')
      .select(COLUMNS)
      .where('party_id', '=', partyId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    return { references: rows.map(toReference) };
  }

  async function addExternalReference({
    tx,
    context,
    input,
  }: Args<{ params: { partyId: string }; body: ExternalReferenceInput }>) {
    const { partyId } = input.params;
    const { system, externalId, url } = input.body;
    await party(tx, partyId, ['active', 'archived']);
    let row;
    try {
      row = await crmDb(tx)
        .insertInto('crm.external_reference')
        .values((eb) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          party_id: partyId,
          system,
          external_id: externalId,
          url: url ?? null,
          added_by: context.membership.id,
        }))
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
    } catch (error) {
      throw isTaken(error) ? deps.refuse(409, taken) : error;
    }
    await context.audit.record({
      action: 'crm.external_reference.added',
      entityId: row.id,
      subjectPartyId: partyId,
      changes: {
        'crm.external_reference.system': { after: system },
        'crm.external_reference.external_id': {},
        'crm.external_reference.url': {},
      },
    });
    return toReference(row);
  }

  async function removeExternalReference({
    tx,
    context,
    input,
  }: Args<{ params: { partyId: string; referenceId: string } }>): Promise<undefined> {
    const { partyId, referenceId } = input.params;
    await party(tx, partyId, ['active', 'archived', 'merged']);
    const removed = await crmDb(tx)
      .deleteFrom('crm.external_reference')
      .where('id', '=', referenceId)
      .where('party_id', '=', partyId)
      .returning(['id', 'system'])
      .executeTakeFirst();
    if (removed === undefined) throw deps.notFound();
    await context.audit.record({
      action: 'crm.external_reference.removed',
      entityId: removed.id,
      subjectPartyId: partyId,
      changes: { 'crm.external_reference.system': { before: removed.system } },
    });
    return undefined;
  }

  /** What a replay of `addExternalReference` answers: the reference as it reads now. */
  async function replayReference({ tx, id }: { tx: Tx; id: string }) {
    const row = await crmDb(tx)
      .selectFrom('crm.external_reference')
      .select(COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return toReference(row);
  }

  return {
    listExternalReferences,
    addExternalReference,
    removeExternalReference,
    replayReference,
  };
}
