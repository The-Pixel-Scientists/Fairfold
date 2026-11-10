// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The objects a snapshot writes. The manifest is encrypted and is what a
// restore reads. The job cannot decrypt it, so beside it goes a reference
// index in the clear, which the next run reads to see what the store holds
// and prune reads to see what is still needed. The index holds what a listing
// of the store already shows, object names, hashes and sizes of ciphertext
// and lock dates, and no hash of a file's content.
//
// Neither ever holds a file name or personal data: each is built field by
// field from ids, hashes and sizes.

import { BackupError } from './codes.ts';
import type { LiveFile } from './plan.ts';
import type { Tier } from './tiers.ts';

export const FORMAT_VERSION = 1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SNAPSHOT_ID = /^\d{8}T\d{6}Z-[0-9a-f]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface ObjectRef {
  key: string;
  versionId: string;
  sha256: string;
  size: number;
  keyId: string;
}

export interface HeldFile {
  tenantId: string;
  fileId: string;
  object: ObjectRef;
  lockUntil: string;
}

export interface Versions {
  migration: string;
  rolesScript: string;
  postgres: string;
  pgDump: string;
}

export interface SnapshotParts {
  snapshotId: string;
  startedAt: Date;
  tier: Tier;
  retainUntil: Date;
  keyId: string;
  versions: Versions;
  dumps: readonly { database: string; object: ObjectRef }[];
  keySnapshot: ObjectRef;
  files: readonly { live: LiveFile; held: HeldFile }[];
}

export const manifestKey = (snapshotId: string): string => `manifests/${snapshotId}.age`;
export const indexKey = (snapshotId: string): string => `indexes/${snapshotId}.json`;
const RUN_RECORDS = 'runs/';
export const runRecordKey = (snapshotId: string): string => `${RUN_RECORDS}${snapshotId}.json`;
/** The job can create a run record but not delete one (ADR 0011). */
export const isRunRecordKey = (key: string): boolean => key.startsWith(RUN_RECORDS);
export const probeKey = (snapshotId: string): string => `probes/${snapshotId}`;
export const dumpKey = (snapshotId: string, database: string): string =>
  `dumps/${snapshotId}/${database}.dump.age`;
/** Kept apart from the data, and on the daily tier whatever the snapshot's tier (ADR 0027). */
export const keySnapshotKey = (snapshotId: string): string => `key-snapshots/${snapshotId}.age`;
export const fileKey = (tenantId: string, fileId: string, snapshotId: string): string =>
  `files/${tenantId}/${fileId}/${snapshotId}.age`;

export function snapshotIdOfManifest(key: string): string | undefined {
  const id = /^manifests\/(.+)\.age$/.exec(key)?.[1];
  return id !== undefined && SNAPSHOT_ID.test(id) ? id : undefined;
}

export function buildManifest(parts: SnapshotParts): string {
  return JSON.stringify({
    formatVersion: FORMAT_VERSION,
    snapshotId: parts.snapshotId,
    startedAt: parts.startedAt.toISOString(),
    tier: parts.tier,
    retainUntil: parts.retainUntil.toISOString(),
    keyId: parts.keyId,
    versions: parts.versions,
    dumps: parts.dumps.map(({ database, object }) => ({ database, object })),
    keySnapshot: parts.keySnapshot,
    files: parts.files.map(({ live, held }) => ({
      tenantId: held.tenantId,
      fileId: held.fileId,
      contentSha256: live.contentSha256,
      contentSize: live.contentSize,
      object: held.object,
      lockUntil: held.lockUntil,
    })),
  });
}

export interface ReferenceIndex {
  snapshotId: string;
  dumps: ObjectRef[];
  files: HeldFile[];
}

/** The key snapshot stays out: naming it here would hold it past its 35 days. */
export function buildIndex(parts: SnapshotParts): string {
  const index: ReferenceIndex & { formatVersion: number } = {
    formatVersion: FORMAT_VERSION,
    snapshotId: parts.snapshotId,
    dumps: parts.dumps.map(({ object }) => object),
    files: parts.files.map(({ held }) => held),
  };
  return JSON.stringify(index);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isObjectRef(value: unknown): value is ObjectRef {
  return (
    isRecord(value) &&
    typeof value['key'] === 'string' &&
    typeof value['versionId'] === 'string' &&
    typeof value['keyId'] === 'string' &&
    typeof value['sha256'] === 'string' &&
    SHA256.test(value['sha256']) &&
    Number.isSafeInteger(value['size'])
  );
}

function isHeldFile(value: unknown): value is HeldFile {
  return (
    isRecord(value) &&
    typeof value['tenantId'] === 'string' &&
    UUID.test(value['tenantId']) &&
    typeof value['fileId'] === 'string' &&
    UUID.test(value['fileId']) &&
    isObjectRef(value['object']) &&
    typeof value['lockUntil'] === 'string' &&
    !Number.isNaN(Date.parse(value['lockUntil']))
  );
}

/** A later format than this job knows is refused, not guessed at. */
export function parseIndex(text: string, snapshotId: string): ReferenceIndex {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupError('index_invalid');
  }
  if (
    !isRecord(value) ||
    value['formatVersion'] !== FORMAT_VERSION ||
    value['snapshotId'] !== snapshotId ||
    !Array.isArray(value['dumps']) ||
    !value['dumps'].every(isObjectRef) ||
    !Array.isArray(value['files']) ||
    !value['files'].every(isHeldFile)
  ) {
    throw new BackupError('index_invalid');
  }
  return { snapshotId, dumps: value['dumps'], files: value['files'] };
}
