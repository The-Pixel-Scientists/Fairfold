// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The job's settings, from the environment. Credentials are only ever named
// by a NAME_FILE variable: a value in the environment is refused, because a
// process's environment is too easy to read.

import { isAbsolute } from 'node:path';

import { readDatabaseName, readServer } from '../../../packages/db/scripts/settings.ts';
import { isLoopbackHost, readSetting, type Env } from '../../../packages/db/src/settings.ts';

export interface StoreSettings {
  endpoint: string;
  region: string;
  bucket: string;
  credentialsFile: string;
}

export interface Settings {
  host: string;
  port: number;
  /** null only for a database server on this machine. */
  caFile: string | null;
  passwordFile: string;
  applicationDatabase: string;
  otherDatabases: string[];
  tools: { pgDump: string; psql: string; age: string; s3: string };
  store: StoreSettings;
  source: StoreSettings;
  recipientsFile: string;
  keyId: string;
  scratchParent: string;
}

const CREDENTIALS = [
  'TPS_DB_BACKUP_READER_PASSWORD',
  'TPS_BACKUP_STORE_CREDENTIALS',
  'TPS_BACKUP_SOURCE_CREDENTIALS',
] as const;

const KEY_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function readPath(env: Env, name: string): string {
  const path = readSetting(env, name);
  if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path.`);
  return path;
}

/** Credentials and data travel only over TLS, or stay on this machine. */
function readEndpoint(env: Env, name: string): string {
  const endpoint = readSetting(env, name);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`${name} must be a URL.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(host))) {
    throw new Error(`${name} must use https unless it is on this machine.`);
  }
  return endpoint;
}

function readCa(env: Env, host: string): string | null {
  const tls = env['TPS_DB_TLS'] || (isLoopbackHost(host) ? 'disable' : 'verify-full');
  if (tls === 'verify-full') return readPath(env, 'TPS_DB_TLS_CA_FILE');
  if (tls === 'disable' && isLoopbackHost(host)) return null;
  throw new Error('Set TPS_DB_TLS to verify-full. Only a server on this machine may go without.');
}

function readStore(env: Env, prefix: string, credentials: string): StoreSettings {
  return {
    endpoint: readEndpoint(env, `${prefix}_ENDPOINT`),
    region: readSetting(env, `${prefix}_REGION`),
    bucket: readSetting(env, `${prefix}_BUCKET`),
    credentialsFile: readPath(env, credentials),
  };
}

/** Throws an Error naming the variable at fault, never its value. */
export function readSettings(env: Env): Settings {
  for (const name of CREDENTIALS) {
    if (env[name]) throw new Error(`Set ${name}_FILE, not ${name}.`);
  }
  const { host, port } = readServer(env);
  const [applicationDatabase, ...otherDatabases] = readSetting(env, 'TPS_BACKUP_DATABASES')
    .split(',')
    .map((name) => readDatabaseName({ TPS_BACKUP_DATABASES: name }, 'TPS_BACKUP_DATABASES'));
  const keyId = readSetting(env, 'TPS_BACKUP_KEY_ID');
  if (applicationDatabase === undefined || !KEY_ID.test(keyId)) {
    throw new Error('Set TPS_BACKUP_KEY_ID to a short id of letters, digits, dots and hyphens.');
  }
  return {
    host,
    port,
    caFile: readCa(env, host),
    passwordFile: readPath(env, 'TPS_DB_BACKUP_READER_PASSWORD_FILE'),
    applicationDatabase,
    otherDatabases,
    tools: {
      pgDump: readPath(env, 'TPS_BACKUP_PG_DUMP'),
      psql: readPath(env, 'TPS_BACKUP_PSQL'),
      age: readPath(env, 'TPS_BACKUP_AGE'),
      s3: readPath(env, 'TPS_BACKUP_S3_CLIENT'),
    },
    store: readStore(env, 'TPS_BACKUP_STORE', 'TPS_BACKUP_STORE_CREDENTIALS_FILE'),
    source: readStore(env, 'TPS_STORAGE', 'TPS_BACKUP_SOURCE_CREDENTIALS_FILE'),
    recipientsFile: readPath(env, 'TPS_BACKUP_RECIPIENTS_FILE'),
    keyId,
    scratchParent: readPath(env, 'TPS_BACKUP_SCRATCH_DIR'),
  };
}
