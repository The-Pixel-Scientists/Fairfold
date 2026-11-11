// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Value history (ADR 0025): one row for each party field a change touched,
// written in the same transaction as the change. The values are personal, so
// they reach staff through console reads only and never an audit event, a
// log line or a problem.

import type { PartyKind, ValueHistoryField, ValueHistoryPage } from '../contracts/index.ts';
import { decodeCursor, encodeCursor } from './organisations.ts';
import { partyMergeSet } from './subject-data.ts';
import { partyDb, type PartyDb, type Tx } from './tables.ts';

const PAGE_SIZE = 25;

export interface FieldChange {
  readonly field: ValueHistoryField;
  readonly before: string | null;
  readonly after: string | null;
}

type Values = Readonly<Record<string, string | null>>;

/** The changes from `current` to `next`, a field named `<kind>.<column>` for each column that differs. */
export function fieldChanges(kind: PartyKind, current: Values, next: Values): FieldChange[] {
  return Object.keys(next)
    .filter((column) => current[column] !== next[column])
    .map((column) => ({
      field: `${kind}.${column}` as ValueHistoryField,
      before: current[column] ?? null,
      after: next[column] ?? null,
    }));
}

/** Keep the changes, naming the member who made them, or none for the system. */
export async function writeHistory(
  db: PartyDb,
  party: { readonly id: string; readonly kind: PartyKind },
  changedBy: string | null,
  changes: readonly FieldChange[],
): Promise<void> {
  if (changes.length === 0) return;
  await db
    .insertInto('party.value_history')
    .values((eb) =>
      changes.map(({ field, before, after }) => ({
        tenant_id: eb.fn<string>('app.current_tenant_id', []),
        party_id: party.id,
        party_kind: party.kind,
        field_id: field,
        old_value: before,
        new_value: after,
        changed_by: changedBy,
      })),
    )
    .execute();
}

/**
 * A page of the party's history and that of every party merged into it,
 * newest first. Null if the cursor names no entry of it.
 */
export async function readHistory(
  tx: Tx,
  partyId: string,
  cursor: string | undefined,
): Promise<ValueHistoryPage | null> {
  const db = partyDb(tx);
  const ids = await partyMergeSet(tx, partyId);
  let select = db
    .selectFrom('party.value_history')
    .select(['id', 'field_id', 'old_value', 'new_value', 'changed_at', 'changed_by'])
    .where('party_id', 'in', ids)
    .orderBy('changed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(PAGE_SIZE + 1);
  if (cursor !== undefined) {
    const after = decodeCursor(cursor);
    const known =
      after === null
        ? undefined
        : await db
            .selectFrom('party.value_history')
            .select('id')
            .where('id', '=', after)
            .where('party_id', 'in', ids)
            .executeTakeFirst();
    if (known === undefined) return null;
    // The row's own timestamp, at the database's precision, not a rounded copy of it.
    select = select.where((eb) => {
      const at = () =>
        eb
          .selectFrom('party.value_history as h')
          .select('h.changed_at')
          .where('h.id', '=', known.id);
      return eb.or([
        eb('changed_at', '<', at()),
        eb.and([eb('changed_at', '=', at()), eb('id', '<', known.id)]),
      ]);
    });
  }
  const rows = await select.execute();
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    entries: page.map((row) => ({
      fieldId: row.field_id,
      previousValue: row.old_value,
      newValue: row.new_value,
      changedAt: row.changed_at.toISOString(),
      changedBy: row.changed_by,
    })),
    nextCursor: rows.length > PAGE_SIZE && last !== undefined ? encodeCursor(last.id) : null,
  };
}
