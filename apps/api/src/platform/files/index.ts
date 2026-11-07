// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The file service (ADR 0047, ADR 0030): the scanner, the object store and
// the operations a handler uses, bound to one request. Only this folder
// imports the signer's code or reads the storage keys.

import { cachedVersion, scan, signatureVersion } from './clamd.ts';
import type { FileSettings } from './settings.ts';
import { sendFile } from './send.ts';
import { createSlots } from './slots.ts';
import { createStore } from './store.ts';
import {
  createRemovalStorage,
  createScannerStorage,
  createStorage,
  type Storage,
} from './storage.ts';
import type { RecheckDependencies } from './recheck.ts';
import type { SweepStorage } from './sweep.ts';
import type { FileService } from './types.ts';
import { deleteWithheld } from './withhold.ts';

export { loadFileSettings, type FileSettings } from './settings.ts';
export { createScannerStorage, createStorage } from './storage.ts';
export { uploadGate, type Admission, type UploadGate } from './upload-gate.ts';
export type {
  FileReply,
  FileRequest,
  FileService,
  RequestFiles,
  StoreInput,
  StoreResult,
} from './types.ts';

export function createFileService(
  settings: FileSettings,
  storage: Storage = createStorage(settings.storage),
  scanner: Storage = createScannerStorage(settings.storage),
): FileService {
  const slots = createSlots(settings.maxStores);
  const version = cachedVersion(() => signatureVersion(settings.clamd));
  const scanBytes = (bytes: Uint8Array) => scan(settings.clamd, bytes);
  const store = createStore({ storage, scan: scanBytes, slots, version });
  const sending = { storage, scanner, scan: scanBytes, version, slots };
  return (request) => ({
    store: (input) => store(request, input),
    send: (fileId, options) => sendFile(sending, request, fileId, options),
    deleteWithheld: (fileId) => deleteWithheld(request, fileId),
  });
}

export { recheckTenant, type RecheckCounts, type RecheckDependencies } from './recheck.ts';
export { sweepTenant, type SweepCounts, type SweepStorage } from './sweep.ts';

/** What the worker's tenant files job uses: the removal, scanner and write keys, and clamd. */
export type FilesJobDependencies = SweepStorage & RecheckDependencies;

export function createFilesJob(
  settings: FileSettings,
  fetchImpl: typeof fetch = fetch,
): FilesJobDependencies {
  return {
    removal: createRemovalStorage(settings.storage, fetchImpl),
    scanner: createScannerStorage(settings.storage, fetchImpl),
    restore: createStorage(settings.storage, fetchImpl),
    scan: (bytes) => scan(settings.clamd, bytes),
    version: cachedVersion(() => signatureVersion(settings.clamd)),
  };
}
