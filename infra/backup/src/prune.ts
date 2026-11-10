// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Removes objects that have expired, so an erasure or a funder's exit takes
// effect when the last copy goes (ADR 0027).

import type { JobInput, RunRecord } from './job.ts';
import { isRunRecordKey, snapshotIdOfManifest, type ReferenceIndex } from './manifest.ts';
import { isReferenced, liveReferences, prunable, type PruneCandidate } from './plan.ts';
import { readIndex } from './snapshot.ts';

/** Removes what has expired. An unreadable lock or index keeps the data. */
export async function pruneExpired(input: JobInput, record: RunRecord): Promise<void> {
  const { store, scratch, now } = input;
  const moment = now();
  const versions = await store.listVersions('');
  const indexes: ReferenceIndex[] = [];
  for (const version of versions) {
    const snapshotId = snapshotIdOfManifest(version.key);
    if (snapshotId === undefined) continue;
    const lock = await store.retention(version.key, version.versionId);
    if (lock !== null && lock.until.getTime() <= moment.getTime()) continue;
    indexes.push(await readIndex(store, scratch, snapshotId));
  }
  const refs = liveReferences(indexes);
  const candidates: PruneCandidate[] = [];
  for (const { key, versionId } of versions) {
    if (isRunRecordKey(key) || isReferenced(refs, { key, versionId })) continue;
    const lock = await store.retention(key, versionId);
    candidates.push({ key, versionId, retainUntil: lock?.until ?? null });
  }
  for (const { key, versionId } of prunable(candidates, refs, moment)) {
    await store.remove(key, versionId);
    record.pruned += 1;
  }
}
