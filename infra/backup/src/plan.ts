// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The decisions a run makes, kept free of input and output: which files to
// copy, which locks to extend and what may be deleted. Each one fails towards
// keeping data.

import { BackupError } from './codes.ts';
import type { HeldFile, ObjectRef, ReferenceIndex } from './manifest.ts';

const CLEAN_KEY =
  /^clean\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A clean file the database lists: its id, where it lives and its content's hash and size. */
export interface LiveFile {
  tenantId: string;
  fileId: string;
  storageKey: string;
  contentSha256: string;
  contentSize: number;
}

/** Only an exact clean key is ever read, so nothing outside the clean prefix can be copied. */
export function assertCleanKey(key: string): void {
  if (!CLEAN_KEY.test(key)) throw new BackupError('file_key_refused');
}

const fileIdentity = (file: { tenantId: string; fileId: string }): string =>
  `${file.tenantId}/${file.fileId}`;

/**
 * Splits the live files into those the store lacks and those it already holds.
 * Measured against the last complete snapshot, so a missed night's files are
 * copied by the next run. A clean file never changes, so an id is enough.
 */
export function diffFiles(
  live: readonly LiveFile[],
  held: readonly HeldFile[],
): { toCopy: LiveFile[]; kept: { live: LiveFile; held: HeldFile }[] } {
  const byId = new Map(held.map((file) => [fileIdentity(file), file]));
  const toCopy: LiveFile[] = [];
  const kept: { live: LiveFile; held: HeldFile }[] = [];
  for (const file of live) {
    const match = byId.get(fileIdentity(file));
    if (match === undefined) toCopy.push(file);
    else kept.push({ live: file, held: match });
  }
  return { toCopy, kept };
}

/** Whether a lock must be lengthened to reach a date. A lock is never shortened. */
export function needsExtension(lockUntil: string, wanted: Date): boolean {
  return new Date(lockUntil).getTime() < wanted.getTime();
}

const versionRef = (key: string, versionId: string): string => `${key}\0${versionId}`;

/** Every object version a live snapshot needs. */
export function liveReferences(indexes: readonly ReferenceIndex[]): Set<string> {
  const refs = (index: ReferenceIndex): ObjectRef[] => [
    ...index.dumps,
    ...index.files.map((file) => file.object),
  ];
  return new Set(indexes.flatMap(refs).map((ref) => versionRef(ref.key, ref.versionId)));
}

export interface PruneCandidate {
  key: string;
  versionId: string;
  /** null when the store gave no retention date, which keeps the object. */
  retainUntil: Date | null;
}

export function isReferenced(
  refs: ReadonlySet<string>,
  object: { key: string; versionId: string },
): boolean {
  return refs.has(versionRef(object.key, object.versionId));
}

/** What may go: objects past their lock that no live snapshot references. */
export function prunable(
  candidates: readonly PruneCandidate[],
  refs: ReadonlySet<string>,
  now: Date,
): PruneCandidate[] {
  return candidates.filter(
    (candidate) =>
      !isReferenced(refs, candidate) &&
      candidate.retainUntil !== null &&
      candidate.retainUntil.getTime() <= now.getTime(),
  );
}
