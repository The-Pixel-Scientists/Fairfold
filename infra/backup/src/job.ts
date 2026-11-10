// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One run of the backup (ADR 0011): the start-up checks, the snapshot, the
// prune and the run record.

import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertRecipients, checkDatabase, checkStore } from './checks.ts';
import { failureCode, type Outcome } from './codes.ts';
import { runRecordKey } from './manifest.ts';
import { pruneExpired } from './prune.ts';
import { takeSnapshot } from './snapshot.ts';
import type { ObjectStore } from './store.ts';
import { addMonths, datePrefix, snapshotIdFor, tierFor, type Tier } from './tiers.ts';
import type { Tools } from './tools.ts';

const RUN_RECORD_MONTHS = 12;

export interface RunRecord {
  runId: string;
  outcome: Outcome;
  tier: Tier;
  objects: number;
  bytes: number;
  filesCopied: number;
  filesHeld: number;
  locksExtended: number;
  pruned: number;
}

export interface JobInput {
  store: ObjectStore;
  tools: Tools;
  scratch: string;
  applicationDatabase: string;
  otherDatabases: readonly string[];
  keyId: string;
  recipients: string;
  now: () => Date;
  suffix: string;
}

async function writeRunRecord(input: JobInput, record: RunRecord, start: Date): Promise<void> {
  const file = join(input.scratch, 'run-record');
  await writeFile(file, JSON.stringify(record));
  await input.store.put(
    runRecordKey(record.runId),
    file,
    addMonths(start, RUN_RECORD_MONTHS),
    input.keyId,
  );
}

/** Runs the body in a new directory, which can hold secrets and is removed whatever happens. */
export async function withScratch(
  parent: string,
  body: (scratch: string) => Promise<void>,
): Promise<void> {
  const scratch = mkdtempSync(join(parent, 'backup-'));
  const wipe = () => {
    rmSync(scratch, { recursive: true, force: true });
  };
  const onTerminate = () => {
    wipe();
    process.exit(143);
  };
  process.once('SIGTERM', onTerminate);
  try {
    await body(scratch);
  } finally {
    process.off('SIGTERM', onTerminate);
    wipe();
  }
}

/** Runs the backup. Everything it reports is a code or a count. */
export async function runBackup(input: JobInput): Promise<RunRecord> {
  const start = input.now();
  const tier = tierFor(start);
  const record: RunRecord = {
    runId: snapshotIdFor(start, input.suffix),
    outcome: 'unexpected',
    tier,
    objects: 0,
    bytes: 0,
    filesCopied: 0,
    filesHeld: 0,
    locksExtended: 0,
    pruned: 0,
  };
  let storeChecked = false;
  try {
    assertRecipients(input.recipients);
    const versions = await checkDatabase(input.tools);
    await checkStore(input, record.runId, start);
    storeChecked = true;
    const today = await input.store.listVersions(`manifests/${datePrefix(start)}`);
    if (today.length > 0) {
      record.outcome = 'already_complete';
    } else {
      await takeSnapshot(input, record, start, versions);
      try {
        await pruneExpired(input, record);
        record.outcome = 'ok';
      } catch {
        record.outcome = 'prune_failed';
      }
    }
  } catch (error) {
    record.outcome = failureCode(error);
  }
  if (storeChecked) {
    try {
      await writeRunRecord(input, record, start);
    } catch {
      // The log line still reports the run, and a missing record raises the alert.
    }
  }
  return record;
}
