// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The backup store, through an S3 client command, for any S3-compatible store
// with object lock. Every object is locked in compliance mode, and nothing
// here can shorten a lock: the only retention call lengthens one, and the
// store itself refuses anything else.

import { join } from 'node:path';

import { BackupError } from './codes.ts';
import { runTool, type Stage } from './exec.ts';
import { assertCleanKey } from './plan.ts';
import type { Settings, StoreSettings } from './settings.ts';

export interface ObjectVersion {
  key: string;
  versionId: string;
  isLatest: boolean;
}

export interface ObjectStore {
  /** Whether the bucket reports versioning and object lock on. */
  isLocked(): Promise<boolean>;
  /** Writes an object locked until the date and returns its version id. */
  put(key: string, file: string, until: Date, keyId: string): Promise<string>;
  get(key: string, versionId: string, file: string): Promise<void>;
  /** The object's lock, or null if it has none or the store will not say. */
  retention(key: string, versionId: string): Promise<{ mode: string; until: Date } | null>;
  /** Lengthens a lock. */
  extend(key: string, versionId: string, until: Date): Promise<void>;
  listVersions(prefix: string): Promise<ObjectVersion[]>;
  remove(key: string, versionId: string): Promise<void>;
}

export type Exec = (args: readonly string[]) => Promise<string>;

/** An environment holding the path to the credentials, never their values. */
function clientEnv(scratch: string, credentialsFile: string): Record<string, string> {
  return {
    HOME: scratch,
    LC_ALL: 'C',
    TZ: 'UTC',
    AWS_SHARED_CREDENTIALS_FILE: credentialsFile,
    AWS_CONFIG_FILE: join(scratch, 'client-config'),
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_PAGER: '',
  };
}

const connection = (store: StoreSettings): string[] => [
  '--endpoint-url',
  store.endpoint,
  '--region',
  store.region,
];

/** Reads a clean file to standard output for encryption. */
export function sourceStage(settings: Settings, scratch: string, storageKey: string): Stage {
  assertCleanKey(storageKey);
  return {
    path: settings.tools.s3,
    args: [
      's3',
      'cp',
      `s3://${settings.source.bucket}/${storageKey}`,
      '-',
      '--only-show-errors',
      ...connection(settings.source),
    ],
    env: clientEnv(scratch, settings.source.credentialsFile),
    failure: 'source_failed',
  };
}

export function storeExec(settings: Settings, scratch: string): Exec {
  return (args) =>
    runTool({
      path: settings.tools.s3,
      args,
      env: clientEnv(scratch, settings.store.credentialsFile),
      failure: 'store_failed',
    });
}

function parse(output: string): Record<string, unknown> {
  if (output.trim() === '') return {};
  try {
    const value: unknown = JSON.parse(output);
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  } catch {
    // Reported below: a client that prints something else has failed.
  }
  throw new BackupError('store_failed');
}

function field(record: unknown, name: string): unknown {
  return typeof record === 'object' && record !== null
    ? (record as Record<string, unknown>)[name]
    : undefined;
}

export function createStore(settings: StoreSettings, exec: Exec): ObjectStore {
  const api = async (command: string, args: readonly string[]) =>
    parse(
      await exec([
        's3api',
        command,
        '--bucket',
        settings.bucket,
        ...args,
        ...connection(settings),
        '--output',
        'json',
      ]),
    );
  const version = (key: string, versionId: string) => ['--key', key, '--version-id', versionId];

  return {
    async isLocked() {
      const versioning = await api('get-bucket-versioning', []);
      const lock = await api('get-object-lock-configuration', []);
      return (
        versioning['Status'] === 'Enabled' &&
        field(lock['ObjectLockConfiguration'], 'ObjectLockEnabled') === 'Enabled'
      );
    },
    async put(key, file, until, keyId) {
      const result = await api('put-object', [
        '--key',
        key,
        '--body',
        file,
        '--object-lock-mode',
        'COMPLIANCE',
        '--object-lock-retain-until-date',
        until.toISOString(),
        '--metadata',
        `key-id=${keyId}`,
      ]);
      const versionId = result['VersionId'];
      if (typeof versionId !== 'string' || versionId === '') throw new BackupError('store_failed');
      return versionId;
    },
    async get(key, versionId, file) {
      await api('get-object', [...version(key, versionId), file]);
    },
    async retention(key, versionId) {
      try {
        const result = await api('get-object-retention', version(key, versionId));
        const mode = field(result['Retention'], 'Mode');
        const date = field(result['Retention'], 'RetainUntilDate');
        if (typeof mode !== 'string' || typeof date !== 'string') return null;
        const until = new Date(date);
        return Number.isNaN(until.getTime()) ? null : { mode, until };
      } catch {
        return null;
      }
    },
    async extend(key, versionId, until) {
      await api('put-object-retention', [
        ...version(key, versionId),
        '--retention',
        `Mode=COMPLIANCE,RetainUntilDate=${until.toISOString()}`,
      ]);
    },
    async listVersions(prefix) {
      const result = await api('list-object-versions', ['--prefix', prefix]);
      const versions = result['Versions'];
      if (versions === undefined || versions === null) return [];
      if (!Array.isArray(versions)) throw new BackupError('store_failed');
      return versions.map((entry: unknown) => {
        const key = field(entry, 'Key');
        const versionId = field(entry, 'VersionId');
        if (typeof key !== 'string' || typeof versionId !== 'string') {
          throw new BackupError('store_failed');
        }
        return { key, versionId, isLatest: field(entry, 'IsLatest') === true };
      });
    },
    async remove(key, versionId) {
      await api('delete-object', version(key, versionId));
    },
  };
}
