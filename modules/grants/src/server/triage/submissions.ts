// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The submissions a triage change names. Staff never see a draft, so a draft,
// another tenant's application and an id that exists nowhere all answer the
// same: no record, and a bulk change with one of them changes nothing.

import type { Tx } from '../programme/tables.ts';
import type { TriageDependencies } from './context.ts';
import { triageDb } from './tables.ts';

/** Locks the submissions in id order, so two changes to the same ones wait their turn. */
export async function lockSubmissions(
  tx: Tx,
  deps: Pick<TriageDependencies, 'notFound'>,
  ids: readonly string[],
): Promise<string[]> {
  const rows = await triageDb(tx)
    .selectFrom('grants.application')
    .select('id')
    .where('id', 'in', ids)
    .where('status', '<>', 'draft')
    .orderBy('id')
    .forNoKeyUpdate()
    .execute();
  if (rows.length !== ids.length) throw deps.notFound();
  return rows.map((row) => row.id);
}
