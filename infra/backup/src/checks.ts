// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The start-up checks. Each stops the run, with a code, before it can write
// anything it should not.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BACKUP_ROLE } from '../../../packages/db/scripts/roles.ts';

import { BackupError } from './codes.ts';
import type { JobInput } from './job.ts';
import { probeKey, type Versions } from './manifest.ts';
import type { Tools } from './tools.ts';

const MINIMUM_POSTGRES = 160000;
const PROBE_LOCK_MS = 86_400_000;

/** Public keys only: a private key here would let the job read what it wrote. */
export function assertRecipients(text: string): void {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length === 0 || !lines.every((line) => /^age1[0-9a-z]+$/.test(line))) {
    throw new BackupError('recipients_invalid');
  }
}

/** The role, its exemption and the versions, checked before anything is written. */
export async function checkDatabase(tools: Tools): Promise<Versions> {
  const identity = await tools.identity();
  if (identity.user !== BACKUP_ROLE || identity.sessionUser !== BACKUP_ROLE) {
    throw new BackupError('role_refused');
  }
  if (!identity.exempt) throw new BackupError('role_not_exempt');
  if (identity.rolesScript === null) throw new BackupError('role_refused');
  if (identity.serverVersionNum < MINIMUM_POSTGRES) throw new BackupError('postgres_too_old');
  const pgDump = await tools.pgDumpVersion();
  if (pgDump.major < Math.floor(identity.serverVersionNum / 10000)) {
    throw new BackupError('pg_dump_too_old');
  }
  return {
    migration: identity.migration,
    rolesScript: identity.rolesScript,
    postgres: identity.serverVersion,
    pgDump: pgDump.version,
  };
}

export async function checkStore(
  { store, scratch, keyId }: JobInput,
  snapshotId: string,
  start: Date,
): Promise<void> {
  if (!(await store.isLocked())) throw new BackupError('bucket_lock_missing');
  const until = new Date(start.getTime() + PROBE_LOCK_MS);
  const body = join(scratch, 'probe');
  await writeFile(body, 'probe');
  const key = probeKey(snapshotId);
  const versionId = await store.put(key, body, until, keyId);
  const retention = await store.retention(key, versionId);
  if (retention?.mode !== 'COMPLIANCE' || retention.until.getTime() !== until.getTime()) {
    throw new BackupError('probe_failed');
  }
}
