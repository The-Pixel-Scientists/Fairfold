// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The commands the job calls on the database and for encryption. Plain
// content only ever passes through a pipe: a dump or a file goes straight
// into age and never touches the disk unencrypted.

import { BackupError, type FailureCode } from './codes.ts';
import {
  ageArguments,
  connectionString,
  dumpArguments,
  FILES_SQL,
  IDENTITY_SQL,
  keyDumpArguments,
  parseFileRows,
  parseIdentity,
  parsePgDumpVersion,
  psqlArguments,
  snapshotQuery,
  type Identity,
} from './commands.ts';
import { firstLine, hashingTap, launch, pipeStages, runTool, type Stage } from './exec.ts';
import type { LiveFile } from './plan.ts';
import type { Settings } from './settings.ts';
import { sourceStage } from './store.ts';

export interface SnapshotHolder {
  id: string;
  files(): Promise<LiveFile[]>;
  close(): Promise<void>;
}

export interface Tools {
  identity(): Promise<Identity>;
  pgDumpVersion(): Promise<{ major: number; version: string }>;
  /** One database snapshot, shared by the dump, the key snapshot and the file list. */
  openSnapshot(): Promise<SnapshotHolder>;
  dump(database: string, snapshot: string | null, output: string): Promise<void>;
  dumpKeys(snapshot: string, output: string): Promise<void>;
  /** Copies a file from the live store, encrypted, checking its content hash. */
  copyFile(file: LiveFile, output: string): Promise<void>;
  encrypt(text: string, output: string): Promise<void>;
}

const SNAPSHOT_ID = /^[0-9A-Fa-f]+-[0-9A-Fa-f]+(-\d+)?$/;

/**
 * Opens the transaction whose snapshot the dumps share. A holder that dies
 * during a dump is reported by close(); until then its failure must count as
 * handled, or Node ends the process before the scratch directory is wiped.
 */
export async function holdSnapshot(stage: Stage): Promise<Omit<SnapshotHolder, 'files'>> {
  const holder = launch(stage);
  holder.finished.catch(() => undefined);
  holder.child.stdin.write(
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n',
  );
  const id = (await firstLine(holder.child.stdout))?.trim();
  if (id === undefined || !SNAPSHOT_ID.test(id)) {
    holder.child.stdin.end();
    await holder.finished.catch(() => undefined);
    throw new BackupError('database_failed');
  }
  return {
    id,
    close: async () => {
      holder.child.stdin.end();
      await holder.finished;
    },
  };
}

export function createTools(settings: Settings, scratch: string, passFile: string): Tools {
  const env = { HOME: scratch, LC_ALL: 'C', TZ: 'UTC' };
  const connection = (database: string) => connectionString(settings, database, passFile);
  const app = connection(settings.applicationDatabase);
  const psql = (sql: string, failure: FailureCode = 'database_failed'): Stage => ({
    path: settings.tools.psql,
    args: [...psqlArguments(app), '--command', sql],
    env,
    failure,
  });
  const pgDump = (args: string[]): Stage => ({
    path: settings.tools.pgDump,
    args,
    env,
    failure: 'dump_failed',
  });
  const age = (output: string): Stage => ({
    path: settings.tools.age,
    args: ageArguments(settings.recipientsFile, output),
    env,
    failure: 'encrypt_failed',
  });

  return {
    identity: async () => parseIdentity(await runTool(psql(IDENTITY_SQL))),
    pgDumpVersion: async () =>
      parsePgDumpVersion(await runTool({ ...pgDump(['--version']), failure: 'database_failed' })),
    async openSnapshot() {
      const { id, close } = await holdSnapshot({
        path: settings.tools.psql,
        args: psqlArguments(app),
        env,
        failure: 'database_failed',
      });
      return {
        id,
        close,
        files: async () => parseFileRows(await runTool(psql(snapshotQuery(id, FILES_SQL)))),
      };
    },
    dump: (database, snapshot, output) =>
      pipeStages(pgDump(dumpArguments(connection(database), snapshot)), age(output)),
    dumpKeys: (snapshot, output) =>
      pipeStages(pgDump(keyDumpArguments(app, snapshot)), age(output)),
    async copyFile(file, output) {
      const { tap, digest } = hashingTap();
      await pipeStages(sourceStage(settings, scratch, file.storageKey), age(output), tap);
      const { sha256, size } = digest();
      if (sha256 !== file.contentSha256 || size !== file.contentSize) {
        throw new BackupError('file_hash_mismatch');
      }
    },
    encrypt: (text, output) => runTool(age(output), text).then(() => undefined),
  };
}
