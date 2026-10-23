// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The object store (ADR 0047): put and streamed get over `fetch`, path-style,
// to the configured endpoint only, never following a redirect. The write key
// is used only for put and the read key only for get. An error says what
// failed and never repeats the key, the endpoint or the store's reply.

import { SafeError } from '../../serialize-error.ts';
import { sha256Hex, signRequest } from './sign.ts';
import type { FileSettings } from './settings.ts';

/** `clean/<tenant id>/<file id>`, the only keys there are (ADR 0047). */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const OBJECT_KEY = new RegExp(`^clean/${UUID}/${UUID}$`);

const PUT_TIMEOUT_MS = 30_000;
/** How long storage may take to start answering a get. */
const GET_TIMEOUT_MS = 10_000;

const EMPTY_HASH = sha256Hex('');

export interface Storage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The object's bytes as a stream, or null if there is no such object. */
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
}

export function createStorage(
  settings: FileSettings['storage'],
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Storage {
  const urlFor = (key: string): URL => {
    if (!OBJECT_KEY.test(key)) throw new SafeError('Storage was given a key that is not ours.');
    return new URL(`/${settings.bucket}/${key}`, settings.endpoint);
  };
  const call = async (init: RequestInit, signal: AbortSignal, url: URL) => {
    try {
      return await fetchImpl(url, { ...init, redirect: 'error', signal });
    } catch (error) {
      throw new SafeError('Storage could not be reached.', { cause: error });
    }
  };

  return {
    async put(key, bytes) {
      const url = urlFor(key);
      const headers = await signRequest({
        method: 'PUT',
        url,
        region: settings.region,
        key: settings.write,
        payloadHash: sha256Hex(bytes),
        now: now(),
      });
      const response = await call(
        { method: 'PUT', headers, body: bytes },
        AbortSignal.timeout(PUT_TIMEOUT_MS),
        url,
      );
      await response.body?.cancel();
      if (!response.ok) {
        throw new SafeError(`Storage refused a write with status ${String(response.status)}.`);
      }
    },

    async get(key) {
      const url = urlFor(key);
      const headers = await signRequest({
        method: 'GET',
        url,
        region: settings.region,
        key: settings.read,
        payloadHash: EMPTY_HASH,
        now: now(),
      });
      // The timeout covers the wait for the answer, not the body that follows.
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, GET_TIMEOUT_MS);
      try {
        const response = await call({ method: 'GET', headers }, controller.signal, url);
        if (response.status === 404) {
          await response.body?.cancel();
          return null;
        }
        if (!response.ok || response.body === null) {
          await response.body?.cancel();
          throw new SafeError(`Storage refused a read with status ${String(response.status)}.`);
        }
        return response.body;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
