// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The file sweep of one tenant (ADR 0030, "Retention"), in that tenant's job
// transaction as app_worker. It removes released files (object, then row),
// refused rows nothing links after 12 months, and objects under the tenant's
// clean/ and withheld/ prefixes that no row points at and that are over an
// hour old. Each object is handled with its row locked (SELECT ... FOR
// UPDATE), checked again under the lock and aged with a HEAD before it is
// deleted, so the sweep never removes the object a row points at: a withhold
// or restore takes the same lock before it writes its copy and keeps it to
// commit. Nothing is deleted outside the two prefixes, and nothing runs if
// the bucket keeps versions.

import type { Transaction } from '@pixel-scientists/db';
import { idSchema } from '@pixel-scientists/domain';

import { SafeError } from '../../serialize-error.ts';
import type { ObjectClient } from './storage.ts';

/** Objects younger than this may belong to an upload still committing. */
const MIN_AGE_MS = 60 * 60 * 1000;
/** The most rows, and the most objects, one run handles; the rest wait for the next. */
export const SWEEP_LIMIT = 500;

type Column<S, I = S> = { readonly __select__: S; readonly __insert__: I; readonly __update__: S };

/** app.file as app_worker may reach it (migrations 0041 and 0042). */
export type WorkerFileTables = {
  'app.file': {
    tenant_id: string;
    id: string;
    content_type: string;
    size_bytes: Column<string>;
    sha256: Buffer | null;
    storage_key: string | null;
    scan_state: string;
    scanned_at: Date | null;
    scan_version: number | null;
    linked_at: Date | null;
    released_at: Date | null;
    erased_at: Date | null;
  };
};

export interface SweepStorage {
  readonly removal: Pick<ObjectClient, 'head' | 'delete' | 'list' | 'versioned'>;
}

export interface SweepCounts {
  readonly released: number;
  readonly refused: number;
  readonly objects: number;
}

export async function sweepTenant(
  trx: Transaction<unknown>,
  { removal }: SweepStorage,
  tenant: string,
  now: () => number = Date.now,
): Promise<SweepCounts> {
  if (await removal.versioned()) throw new SafeError('The files bucket keeps versions.');
  const db = trx.$extendTables<WorkerFileTables>();
  const drop = async (id: string): Promise<boolean> =>
    (
      await trx
        .selectNoFrom((eb) => eb.fn<boolean>('app.delete_swept_file', [eb.val(id)]).as('deleted'))
        .executeTakeFirstOrThrow()
    ).deleted;

  let released = 0;
  const releasedRows = await db
    .selectFrom('app.file')
    .select('id')
    .where('released_at', 'is not', null)
    .limit(SWEEP_LIMIT)
    .execute();
  for (const { id } of releasedRows) {
    const locked = await db
      .selectFrom('app.file')
      .select(['storage_key'])
      .where('id', '=', id)
      .where('released_at', 'is not', null)
      .forUpdate()
      .executeTakeFirst();
    if (locked === undefined) continue;
    if (locked.storage_key !== null) await removal.delete(locked.storage_key);
    if (await drop(id)) released++;
  }

  // The database decides which are 12 months old and unlinked; the oldest come first.
  let refused = 0;
  const refusedRows = await db
    .selectFrom('app.file')
    .select('id')
    .where('scan_state', 'in', ['infected', 'error'])
    .where('linked_at', 'is', null)
    .orderBy('scanned_at')
    .limit(SWEEP_LIMIT)
    .execute();
  for (const { id } of refusedRows) if (await drop(id)) refused++;

  let objects = 0;
  for (const prefix of ['clean', 'withheld']) {
    for await (const key of removal.list(`${prefix}/${tenant}/`)) {
      if (objects >= SWEEP_LIMIT) break;
      const id = key.slice(prefix.length + tenant.length + 2);
      if (key !== `${prefix}/${tenant}/${id}` || !idSchema.safeParse(id).success) continue;
      const locked = await db
        .selectFrom('app.file')
        .select(['storage_key', 'erased_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (locked?.storage_key === key && locked.erased_at === null) continue;
      const modified = await removal.head(key);
      if (modified === null || now() - modified.getTime() < MIN_AGE_MS) continue;
      await removal.delete(key);
      objects++;
    }
  }
  return { released, refused, objects };
}
