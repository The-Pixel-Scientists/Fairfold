// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One snapshot. Objects go up under the daily lock and are lengthened to the
// snapshot's tier only once every upload has been read back, so a failed
// 1 January run leaves 35-day leftovers and not 7-year ones. The manifest goes
// last: a snapshot without one is incomplete and is never used.

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BackupError } from './codes.ts';
import { hashFile } from './exec.ts';
import type { JobInput, RunRecord } from './job.ts';
import {
  buildIndex,
  buildManifest,
  dumpKey,
  fileKey,
  indexKey,
  keySnapshotKey,
  manifestKey,
  parseIndex,
  snapshotIdOfManifest,
  type HeldFile,
  type ObjectRef,
  type ReferenceIndex,
  type SnapshotParts,
  type Versions,
} from './manifest.ts';
import { diffFiles, needsExtension, type LiveFile } from './plan.ts';
import type { ObjectStore } from './store.ts';
import { assertWithinTier, retainUntil } from './tiers.ts';

export async function readIndex(
  store: ObjectStore,
  scratch: string,
  snapshotId: string,
): Promise<ReferenceIndex> {
  const key = indexKey(snapshotId);
  const latest = (await store.listVersions(key)).find(
    (version) => version.key === key && version.isLatest,
  );
  if (latest === undefined) throw new BackupError('index_invalid');
  const file = join(scratch, `index-${snapshotId}`);
  await store.get(key, latest.versionId, file);
  const text = await readFile(file, 'utf8');
  await rm(file);
  return parseIndex(text, snapshotId);
}

/** The newest complete snapshot's index, or null if the store holds none. */
async function latestIndex(store: ObjectStore, scratch: string): Promise<ReferenceIndex | null> {
  const ids = (await store.listVersions('manifests/'))
    .map((version) => snapshotIdOfManifest(version.key))
    .filter((id) => id !== undefined)
    .sort();
  const newest = ids.at(-1);
  return newest === undefined ? null : readIndex(store, scratch, newest);
}

/** Runs a snapshot from an empty scratch directory. */
export async function takeSnapshot(
  input: JobInput,
  record: RunRecord,
  start: Date,
  versions: Versions,
): Promise<void> {
  const { store, tools, scratch, keyId } = input;
  const snapshotId = record.runId;
  const tier = record.tier;
  const retain = retainUntil(start, tier);
  const dailyLock = retainUntil(start, 'daily');

  async function upload(key: string, file: string, until: Date): Promise<ObjectRef> {
    assertWithinTier(start, tier, until);
    const { sha256, size } = await hashFile(file);
    const versionId = await store.put(key, file, until, keyId);
    const readBack = `${file}.read-back`;
    await store.get(key, versionId, readBack);
    const copy = await hashFile(readBack);
    await rm(readBack);
    if (copy.sha256 !== sha256 || copy.size !== size) throw new BackupError('upload_mismatch');
    await rm(file);
    record.objects += 1;
    record.bytes += size;
    return { key, versionId, sha256, size, keyId };
  }

  const previous = await latestIndex(store, scratch);
  const uploadDump = (database: string, output: string): Promise<ObjectRef> =>
    upload(dumpKey(snapshotId, database), output, dailyLock);

  const holder = await tools.openSnapshot();
  let live: LiveFile[];
  let keySnapshot: ObjectRef;
  const dumps: { database: string; object: ObjectRef }[] = [];
  try {
    live = await holder.files();
    const dumpFile = join(scratch, 'dump');
    await tools.dump(input.applicationDatabase, holder.id, dumpFile);
    dumps.push({
      database: input.applicationDatabase,
      object: await uploadDump(input.applicationDatabase, dumpFile),
    });
    const keysFile = join(scratch, 'keys');
    await tools.dumpKeys(holder.id, keysFile);
    keySnapshot = await upload(keySnapshotKey(snapshotId), keysFile, dailyLock);
  } finally {
    await holder.close();
  }
  for (const database of input.otherDatabases) {
    const dumpFile = join(scratch, 'dump');
    await tools.dump(database, null, dumpFile);
    dumps.push({ database, object: await uploadDump(database, dumpFile) });
  }

  const { toCopy, kept } = diffFiles(live, previous?.files ?? []);
  const copied: { live: LiveFile; held: HeldFile }[] = [];
  for (const file of toCopy) {
    const output = join(scratch, 'file');
    await tools.copyFile(file, output);
    const object = await upload(fileKey(file.tenantId, file.fileId, snapshotId), output, dailyLock);
    copied.push({
      live: file,
      held: {
        tenantId: file.tenantId,
        fileId: file.fileId,
        object,
        lockUntil: dailyLock.toISOString(),
      },
    });
    record.filesCopied += 1;
  }
  record.filesHeld = kept.length;

  async function extended(object: ObjectRef, lockUntil: string): Promise<string> {
    if (!needsExtension(lockUntil, retain)) return lockUntil;
    assertWithinTier(start, tier, retain);
    await store.extend(object.key, object.versionId, retain);
    record.locksExtended += 1;
    return retain.toISOString();
  }

  for (const { object } of dumps) await extended(object, dailyLock.toISOString());
  const files = [...kept, ...copied];
  for (const entry of files) {
    entry.held = {
      ...entry.held,
      lockUntil: await extended(entry.held.object, entry.held.lockUntil),
    };
  }

  const parts: SnapshotParts = {
    snapshotId,
    startedAt: start,
    tier,
    retainUntil: retain,
    keyId,
    versions,
    dumps,
    keySnapshot,
    files,
  };
  const indexFile = join(scratch, 'index');
  await writeFile(indexFile, buildIndex(parts));
  await upload(indexKey(snapshotId), indexFile, retain);
  const manifestFile = join(scratch, 'manifest');
  await tools.encrypt(buildManifest(parts), manifestFile);
  await upload(manifestKey(snapshotId), manifestFile, retain);
}
