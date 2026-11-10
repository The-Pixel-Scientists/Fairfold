// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The arguments for pg_dump, psql and age, and how to read what they print.
// Nothing here runs a command, so each can be tested exactly.

import { BACKUP_ROLE } from '../../../packages/db/scripts/roles.ts';

import { BackupError } from './codes.ts';
import { assertCleanKey, type LiveFile } from './plan.ts';
import type { Settings } from './settings.ts';

/** Keys never go in a data dump: they stay out of the long tiers (ADR 0027). */
export const SUBJECT_KEY_TABLE = 'app.subject_key';

const quote = (value: string): string => `'${value.replace(/[\\']/g, '\\$&')}'`;

/** A libpq connection string. It holds paths and never a password. */
export function connectionString(
  settings: Pick<Settings, 'host' | 'port' | 'caFile'>,
  database: string,
  passFile: string,
): string {
  const options: [string, string][] = [
    ['host', settings.host],
    ['port', String(settings.port)],
    ['dbname', database],
    ['user', BACKUP_ROLE],
    ['passfile', passFile],
    ['connect_timeout', '30'],
    ['sslmode', settings.caFile === null ? 'disable' : 'verify-full'],
    ...(settings.caFile === null ? [] : ([['sslrootcert', settings.caFile]] as [string, string][])),
  ];
  return options.map(([key, value]) => `${key}=${quote(value)}`).join(' ');
}

/** The line of a pgpass file for the backup role, escaped as libpq reads it. */
export function passFileLine(settings: Pick<Settings, 'host' | 'port'>, password: string): string {
  const escape = (value: string) => value.replace(/[\\:]/g, '\\$&');
  return `${escape(settings.host)}:${String(settings.port)}:*:${BACKUP_ROLE}:${escape(password)}\n`;
}

/** Row security stays off, so a filtered table stops the dump with an error. */
export function dumpArguments(connection: string, snapshot: string | null): string[] {
  return [
    '--format=custom',
    '--no-password',
    `--exclude-table-data=${SUBJECT_KEY_TABLE}`,
    ...(snapshot === null ? [] : [`--snapshot=${snapshot}`]),
    `--dbname=${connection}`,
  ];
}

export function keyDumpArguments(connection: string, snapshot: string): string[] {
  return [
    '--format=custom',
    '--no-password',
    '--data-only',
    `--table=${SUBJECT_KEY_TABLE}`,
    `--snapshot=${snapshot}`,
    `--dbname=${connection}`,
  ];
}

export function psqlArguments(connection: string): string[] {
  return [
    '--no-psqlrc',
    '--quiet',
    '--tuples-only',
    '--no-align',
    '--field-separator=|',
    '--set=ON_ERROR_STOP=1',
    '--no-password',
    `--dbname=${connection}`,
  ];
}

export function ageArguments(recipientsFile: string, output: string): string[] {
  return ['--encrypt', '--recipients-file', recipientsFile, '--output', output];
}

export interface Identity {
  user: string;
  sessionUser: string;
  exempt: boolean;
  serverVersionNum: number;
  serverVersion: string;
  rolesScript: string | null;
  migration: string;
}

export const IDENTITY_SQL = `SELECT current_user, session_user, r.rolbypassrls,
  current_setting('server_version_num'), current_setting('server_version'),
  coalesce(shobj_description(r.oid, 'pg_authid'), ''),
  coalesce((SELECT max(name) FROM migrations.kysely_migration), '')
FROM pg_roles r WHERE r.rolname = current_user`;

export function parseIdentity(output: string): Identity {
  const [user, sessionUser, exempt, versionNum, serverVersion, comment, migration, extra] = output
    .trim()
    .split('|');
  const serverVersionNum = Number(versionNum);
  if (
    !user ||
    !sessionUser ||
    !serverVersion ||
    migration === undefined ||
    extra !== undefined ||
    !Number.isInteger(serverVersionNum)
  ) {
    throw new BackupError('database_failed');
  }
  return {
    user,
    sessionUser,
    exempt: exempt === 't',
    serverVersionNum,
    serverVersion,
    rolesScript: /^tps-roles-version=(\S+)$/.exec(comment ?? '')?.[1] ?? null,
    migration,
  };
}

/** The major version and full version from `pg_dump --version`. */
export function parsePgDumpVersion(output: string): { major: number; version: string } {
  const match = /\(PostgreSQL\) ((\d+)(?:\.\d+)*)/.exec(output);
  if (match?.[1] === undefined || match[2] === undefined) throw new BackupError('database_failed');
  return { major: Number(match[2]), version: match[1] };
}

const FILE_ROW = /^([0-9a-f-]{36})\|([0-9a-f-]{36})\|([^|]+)\|([0-9a-f]{64})\|(\d+)$/;

/** Names and every other column stay out of the query, so they cannot reach the manifest. */
export const FILES_SQL = `SELECT tenant_id, id, storage_key, encode(sha256, 'hex'), size_bytes
FROM app.file WHERE scan_state = 'clean' AND erased_at IS NULL ORDER BY tenant_id, id`;

export function parseFileRows(output: string): LiveFile[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => {
      const match = FILE_ROW.exec(line);
      const [, tenantId, fileId, storageKey, contentSha256, size] = match ?? [];
      if (!tenantId || !fileId || !storageKey || !contentSha256 || !size) {
        throw new BackupError('database_failed');
      }
      assertCleanKey(storageKey);
      return { tenantId, fileId, storageKey, contentSha256, contentSize: Number(size) };
    });
}

export function snapshotQuery(snapshot: string, sql: string): string {
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '${snapshot}'; ${sql}; COMMIT`;
}
