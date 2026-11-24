// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where duplicate flags are kept (ADR 0025, migration 0110): the two party
// ids in a fixed order, the signal, who first listed the flag and, once set,
// its dismissal. Nothing else about a flag is stored, so there is no name,
// identifier or contact detail here to erase.

import type { DuplicateFlag } from '../../contracts/index.ts';
import { assureDb, iso, type Tx } from '../checklists/context.ts';

/** A flag as listed: parties in fixed order, under the id derived from them. */
export interface FlagKey {
  readonly id: string;
  readonly partyId: string;
  readonly otherPartyId: string;
  readonly signal: DuplicateFlag['signal'];
}

export interface StoredFlag extends FlagKey {
  readonly raisedAt: string;
  readonly dismissal: DuplicateFlag['dismissal'];
}

const columns = [
  'id',
  'party_id',
  'other_party_id',
  'signal',
  'created_at',
  'dismiss_reason',
  'dismissed_by',
  'dismissed_at',
] as const;

type Row = Awaited<ReturnType<typeof read>>[number];

const read = (tx: Tx, ids: readonly string[]) =>
  assureDb(tx)
    .selectFrom('assure.duplicate_flag')
    .select(columns)
    .where('id', 'in', [...ids])
    .execute();

export const toStored = (row: Row): StoredFlag => ({
  id: row.id,
  partyId: row.party_id,
  otherPartyId: row.other_party_id,
  signal: row.signal as StoredFlag['signal'],
  raisedAt: iso(row.created_at),
  dismissal:
    row.dismiss_reason === null || row.dismissed_by === null || row.dismissed_at === null
      ? null
      : {
          reason: row.dismiss_reason as NonNullable<StoredFlag['dismissal']>['reason'],
          dismissedAt: iso(row.dismissed_at),
          dismissedBy: row.dismissed_by,
        },
});

/**
 * Records the flags no one has listed before, as the listing member, and
 * returns every one as stored, by id. A flag already there is left as it is,
 * so a dismissal stays.
 */
export async function recordFlags(
  tx: Tx,
  member: string,
  keys: readonly FlagKey[],
): Promise<Map<string, StoredFlag>> {
  if (keys.length === 0) return new Map();
  const ids = keys.map(({ id }) => id);
  const known = new Set((await read(tx, ids)).map(({ id }) => id));
  const added = keys.filter(({ id }) => !known.has(id));
  if (added.length > 0) {
    await assureDb(tx)
      .insertInto('assure.duplicate_flag')
      .values((eb) =>
        added.map(({ id, partyId, otherPartyId, signal }) => ({
          tenant_id: eb.fn<string>('app.current_tenant_id', []),
          id,
          party_id: partyId,
          other_party_id: otherPartyId,
          signal,
          created_by: member,
          updated_by: member,
        })),
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }
  return new Map((await read(tx, ids)).map((row) => [row.id, toStored(row)]));
}

/** The flag with this id, locked for a dismissal, or undefined when this tenant has none. */
export async function lockFlag(tx: Tx, id: string): Promise<StoredFlag | undefined> {
  const [row] = await assureDb(tx)
    .selectFrom('assure.duplicate_flag')
    .select(columns)
    .where('id', '=', id)
    .forUpdate()
    .execute();
  return row === undefined ? undefined : toStored(row);
}

/** Dismisses a flag that is not dismissed, as the member; the database sets the time. */
export async function dismiss(
  tx: Tx,
  id: string,
  reason: NonNullable<DuplicateFlag['dismissal']>['reason'],
  member: string,
): Promise<StoredFlag> {
  const row = await assureDb(tx)
    .updateTable('assure.duplicate_flag')
    .set({ dismiss_reason: reason, dismissed_by: member, updated_by: member })
    .where('id', '=', id)
    .where('dismissed_by', 'is', null)
    .returning(columns)
    .executeTakeFirstOrThrow();
  return toStored(row);
}
