// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The file service's settings (ADR 0047, ADR 0005): the storage endpoint and
// its two key pairs, the scanner, and the limit on stores at once. All are
// required and checked at start-up; there are no fallback values. Every
// problem is reported at once, like the API's other settings.

import { readSecret, readSetting, type Env } from '@pixel-scientists/db';

import { ConfigError, Secret } from '../../config.ts';

export interface StorageKey {
  readonly accessKeyId: string;
  readonly secretAccessKey: Secret;
}

export interface FileSettings {
  readonly storage: {
    /** Where every storage call goes: scheme, host and port only. */
    readonly endpoint: URL;
    readonly region: string;
    readonly bucket: string;
    /** Used only for put. */
    readonly write: StorageKey;
    /** Used only for get. */
    readonly read: StorageKey;
  };
  readonly clamd: { readonly host: string; readonly port: number; readonly timeoutMs: number };
  /** Stores at once in this process: fewer than the database pool's 10 connections. */
  readonly maxStores: number;
}

/** ADR 0047: clamd's MaxScanTime is 20 seconds, and the API gives up at 25. */
export const MAX_CLAMD_TIMEOUT_MS = 25_000;
const MAX_STORES_LIMIT = 9;

const REGION = /^[a-z0-9-]{1,32}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ACCESS_KEY_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HOST = /^[A-Za-z0-9.:_[\]-]{1,255}$/;

export function loadFileSettings(env: Env, readFile?: (path: string) => string): FileSettings {
  const problems: string[] = [];
  const read = <T>(name: string, load: () => T, check: (value: T) => boolean, rule: string) => {
    try {
      const value = load();
      if (check(value)) return value;
      problems.push(`${name} ${rule}.`);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : `Set ${name}.`);
    }
    return undefined;
  };
  const setting = (name: string, check: (value: string) => boolean, rule: string) =>
    read(name, () => readSetting(env, name), check, rule);
  const integer = (name: string, min: number, max: number) => {
    const text = setting(
      name,
      (value) => /^\d{1,6}$/.test(value) && Number(value) >= min && Number(value) <= max,
      `must be a whole number from ${String(min)} to ${String(max)}`,
    );
    return text === undefined ? undefined : Number(text);
  };
  const key = (idName: string, secretName: string) => {
    const accessKeyId = setting(idName, (value) => ACCESS_KEY_ID.test(value), 'is not valid');
    const secret = read(
      secretName,
      () => readSecret(env, secretName, readFile),
      (value) => value.length >= 8,
      'is too short',
    );
    return accessKeyId === undefined || secret === undefined
      ? undefined
      : { accessKeyId, secretAccessKey: new Secret(secret) };
  };

  const endpoint = setting(
    'TPS_STORAGE_ENDPOINT',
    (value) => {
      try {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          url.username === '' &&
          url.password === '' &&
          url.pathname === '/' &&
          url.search === '' &&
          url.hash === ''
        );
      } catch {
        return false;
      }
    },
    'must be an http or https address with a host and port only',
  );
  const region = setting('TPS_STORAGE_REGION', (v) => REGION.test(v), 'is not valid');
  const bucket = setting('TPS_STORAGE_BUCKET', (v) => BUCKET.test(v), 'is not a bucket name');
  const write = key('TPS_STORAGE_WRITE_ACCESS_KEY_ID', 'TPS_STORAGE_WRITE_SECRET_ACCESS_KEY');
  const readKey = key('TPS_STORAGE_READ_ACCESS_KEY_ID', 'TPS_STORAGE_READ_SECRET_ACCESS_KEY');
  const host = setting('TPS_CLAMD_HOST', (v) => HOST.test(v), 'is not a host name or address');
  const port = integer('TPS_CLAMD_PORT', 1, 65_535);
  const timeoutMs = integer('TPS_CLAMD_TIMEOUT_MS', 1000, MAX_CLAMD_TIMEOUT_MS);
  const maxStores = integer('TPS_FILES_MAX_STORES', 1, MAX_STORES_LIMIT);

  if (
    problems.length > 0 ||
    endpoint === undefined ||
    region === undefined ||
    bucket === undefined ||
    write === undefined ||
    readKey === undefined ||
    host === undefined ||
    port === undefined ||
    timeoutMs === undefined ||
    maxStores === undefined
  ) {
    throw new ConfigError(problems);
  }
  return {
    storage: { endpoint: new URL(endpoint), region, bucket, write, read: readKey },
    clamd: { host, port, timeoutMs },
    maxStores,
  };
}
