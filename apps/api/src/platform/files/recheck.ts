// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The withheld recheck of one tenant (ADR 0030, "Rescans"), in that tenant's
// job transaction as app_worker. Each withheld file last scanned under older
// signatures is read with the scanner key, checked against its hash and
// scanned again, one at a time. A match records the new version and the file
// stays withheld. A scanner error changes nothing. A clean result locks the
// row, checks it is still withheld, not erased and has the key and hash the
// bytes were read under, writes the bytes back under clean/, returns the row
// to clean and records the restore; the lock is kept to commit, and the
// stale withheld/ copy is left for the sweep.

import { createHash } from 'node:crypto';

import type { Transaction } from '@pixel-scientists/db';

import { recordAudit, type JobActor } from '../../audit/writer.ts';
import type { Verdict } from './clamd.ts';
import { cleanKey, readAll, type Storage } from './storage.ts';
import type { WorkerFileTables } from './sweep.ts';

/** The most files one run rescans; the rest wait for the next. */
export const RECHECK_LIMIT = 200;

export interface RecheckDependencies {
  /** The scanner key: reads withheld/. */
  readonly scanner: Pick<Storage, 'get'>;
  /** The write key: puts the restored copy under clean/. */
  readonly restore: Pick<Storage, 'put'>;
  readonly scan: (bytes: Uint8Array) => Promise<Verdict>;
  /** clamd's signature version now, or null if it cannot say. */
  readonly version: () => Promise<number | null>;
}

export interface RecheckCounts {
  readonly restored: number;
  readonly stillWithheld: number;
}

export async function recheckTenant(
  trx: Transaction<unknown>,
  deps: RecheckDependencies,
  tenant: string,
  actor: JobActor,
): Promise<RecheckCounts> {
  const version = await deps.version();
  if (version === null) return { restored: 0, stillWithheld: 0 };
  const db = trx.$extendTables<WorkerFileTables>();
  const due = await db
    .selectFrom('app.file')
    .select(['id', 'storage_key', 'sha256'])
    .where('scan_state', '=', 'withheld')
    .where('erased_at', 'is', null)
    .where((eb) => eb.or([eb('scan_version', 'is', null), eb('scan_version', '<', version)]))
    .orderBy('scanned_at')
    .limit(RECHECK_LIMIT)
    .execute();

  let restored = 0;
  let stillWithheld = 0;
  for (const { id, storage_key: key, sha256: hash } of due) {
    if (key === null || hash === null) continue;
    const object = await deps.scanner.get(key).catch(() => null);
    const bytes = object === null ? null : await readAll(object).catch(() => null);
    if (bytes === null || !createHash('sha256').update(bytes).digest().equals(hash)) continue;
    const verdict = await deps.scan(bytes);
    if (verdict === 'error') continue;

    // Locked before anything is written, and kept to commit.
    const locked = await db
      .selectFrom('app.file')
      .select(['storage_key', 'sha256'])
      .where('id', '=', id)
      .where('scan_state', '=', 'withheld')
      .where('erased_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (locked?.storage_key !== key || !locked.sha256?.equals(hash)) continue;

    if (verdict === 'infected') {
      await db
        .updateTable('app.file')
        .set({ scan_version: version })
        .where('id', '=', id)
        .execute();
      stillWithheld++;
      continue;
    }
    const restoredKey = cleanKey(tenant, id);
    await deps.restore.put(restoredKey, bytes);
    await db
      .updateTable('app.file')
      .set({ scan_state: 'clean', storage_key: restoredKey, scan_version: version })
      .where('id', '=', id)
      .execute();
    await recordAudit(trx, actor, {
      action: 'platform.file.restored',
      entityId: id,
      changes: {
        'app.file.scan_state': { before: 'withheld', after: 'clean' },
        'app.file.scan_version': { after: version },
      },
    });
    restored++;
  }
  return { restored, stillWithheld };
}
