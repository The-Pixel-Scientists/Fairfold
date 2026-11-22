// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm's part of a merge (ADR 0025), run in the merge's own transaction like
// every module's, whether or not crm is switched on for the tenant. The
// loser's list memberships, interactions and external references move to
// the survivor. A list the survivor is already on keeps only the survivor's
// membership, and an event-fed interaction the survivor already has stays on
// the loser, since no app role may delete an interaction and the unique key
// refuses a second one. Merge records are never touched: they keep the ids
// they were written with. The merge's deciding member and the tenant are the
// transaction's, so neither is an argument.

import type {
  RepointInput,
  RepointParty,
  RepointResult,
  RepointRow,
} from '@pixel-scientists/party/contracts';

import { crmDb, type Tx } from './context.ts';

const moved = (table: string, ids: readonly { id: string }[]): RepointRow[] =>
  ids.map(({ id }) => ({ table, rowId: id, change: 'repointed' }));

async function repoint(tx: Tx, { loserId, survivorId }: RepointInput): Promise<RepointResult> {
  const db = crmDb(tx);

  await db
    .deleteFrom('crm.list_member')
    .where('party_id', '=', loserId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('crm.list_member as kept')
          .select('kept.id')
          .whereRef('kept.list_id', '=', 'crm.list_member.list_id')
          .where('kept.party_id', '=', survivorId),
      ),
    )
    .execute();
  const members = await db
    .updateTable('crm.list_member')
    .set({ party_id: survivorId })
    .where('party_id', '=', loserId)
    .returning('id')
    .execute();

  const interactions = await db
    .updateTable('crm.interaction')
    .set({ party_id: survivorId })
    .where('party_id', '=', loserId)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('crm.interaction as kept')
            .select('kept.id')
            .where('kept.party_id', '=', survivorId)
            .whereRef('kept.source_module', '=', 'crm.interaction.source_module')
            .whereRef('kept.source_entity_type', '=', 'crm.interaction.source_entity_type')
            .whereRef('kept.source_entity_id', '=', 'crm.interaction.source_entity_id')
            .whereRef('kept.kind', '=', 'crm.interaction.kind'),
        ),
      ),
    )
    .returning('id')
    .execute();

  const references = await db
    .updateTable('crm.external_reference')
    .set({ party_id: survivorId })
    .where('party_id', '=', loserId)
    .returning('id')
    .execute();

  return {
    ok: true,
    rows: [
      ...moved('crm.list_member', members),
      ...moved('crm.interaction', interactions),
      ...moved('crm.external_reference', references),
    ],
  };
}

/** crm's entry in the registry the merge executor runs. An unmerge is not built, so a restore always refuses. */
export const crmRepoint: RepointParty<Tx> = {
  module: 'crm',
  repoint,
  restore: () => Promise.resolve({ ok: false, conflict: 'module_refused' }),
};
