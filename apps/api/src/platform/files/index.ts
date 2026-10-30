// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The file service (ADR 0047): the scanner, the object store and the two
// operations a handler uses, bound to one request. Only this folder imports
// the signer's code or reads the storage keys.

import { scan } from './clamd.ts';
import type { FileSettings } from './settings.ts';
import { sendFile } from './send.ts';
import { createStore } from './store.ts';
import { createStorage, type Storage } from './storage.ts';
import type { FileService } from './types.ts';

export { loadFileSettings, type FileSettings } from './settings.ts';
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
): FileService {
  const store = createStore({
    storage,
    scan: (bytes) => scan(settings.clamd, bytes),
    maxStores: settings.maxStores,
  });
  return (request) => ({
    store: (input) => store(request, input),
    send: (fileId, options) => sendFile(storage, request, fileId, options),
  });
}
