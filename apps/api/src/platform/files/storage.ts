// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The object store (ADR 0047, ADR 0030): calls over `fetch`, path-style, to
// the configured endpoint only, never following a redirect. Each key pair
// has its own client, so a key is used for one purpose: the write key puts
// under clean/, the read key gets under clean/, the scanner key reads and
// writes under withheld/ and reads clean/, and the removal key lists, heads
// and deletes under both prefixes. An error says what failed and never
// repeats the key, the endpoint or the store's reply.

import { MAX_FILE_BYTES } from '@pixel-scientists/domain/files';

import { SafeError } from '../../serialize-error.ts';
import { sha256Hex, signRequest } from './sign.ts';
import type { FileSettings, StorageKey } from './settings.ts';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CLEAN_KEY = new RegExp(`^clean/${UUID}/${UUID}$`);
const WITHHELD_KEY = new RegExp(`^withheld/${UUID}/${UUID}$`);
const PREFIX = new RegExp(`^(?:clean|withheld)/${UUID}/$`);

const PUT_TIMEOUT_MS = 30_000;
/** How long storage may take to start answering a call. */
const CALL_TIMEOUT_MS = 10_000;

const EMPTY_HASH = sha256Hex('');

export const cleanKey = (tenant: string, file: string): string => `clean/${tenant}/${file}`;
export const withheldKey = (tenant: string, file: string): string => `withheld/${tenant}/${file}`;

/** The put and streamed get the file service uses, for `clean/` objects. */
export interface Storage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The object's bytes as a stream, or null if there is no such object. */
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
}

/** What a key pair may do, to the prefixes it is allowed. */
export interface ObjectClient {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  /** When the object last changed, or null if there is none. */
  head(key: string): Promise<Date | null>;
  delete(key: string): Promise<void>;
  /** Every key under `prefix` (`clean/<tenant id>/`), a page at a time. */
  list(prefix: string): AsyncGenerator<string>;
  /** Whether the bucket keeps versions, enabled or suspended. */
  versioned(): Promise<boolean>;
}

type Where = FileSettings['storage'];

function objectClient(
  settings: Pick<Where, 'endpoint' | 'region' | 'bucket'>,
  key: StorageKey,
  allowed: readonly RegExp[],
  fetchImpl: typeof fetch,
  now: () => Date,
): ObjectClient {
  const check = (objectKey: string): string => {
    if (!allowed.some((pattern) => pattern.test(objectKey))) {
      throw new SafeError('Storage was given a key that is not ours.');
    }
    return objectKey;
  };
  const bucketUrl = (query: Record<string, string>): URL => {
    const url = new URL(`/${settings.bucket}`, settings.endpoint);
    url.search = new URLSearchParams(query).toString();
    return url;
  };
  const call = async (
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
    url: URL,
    body?: Uint8Array,
    timeoutMs = CALL_TIMEOUT_MS,
  ) => {
    const headers = await signRequest({
      method,
      url,
      region: settings.region,
      key,
      payloadHash: body === undefined ? EMPTY_HASH : sha256Hex(body),
      now: now(),
      query: Object.fromEntries(url.searchParams),
    });
    // The timeout covers the wait for the answer, not the body that follows.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      throw new SafeError('Storage could not be reached.', { cause: error });
    } finally {
      clearTimeout(timer);
    }
  };
  const refuse = async (response: Response, what: string): Promise<never> => {
    await response.body?.cancel();
    throw new SafeError(`Storage refused ${what} with status ${String(response.status)}.`);
  };
  const objectUrl = (objectKey: string): URL =>
    new URL(`/${settings.bucket}/${check(objectKey)}`, settings.endpoint);

  return {
    async put(objectKey, bytes) {
      const response = await call('PUT', objectUrl(objectKey), bytes, PUT_TIMEOUT_MS);
      await response.body?.cancel();
      if (!response.ok) await refuse(response, 'a write');
    },

    async get(objectKey) {
      const response = await call('GET', objectUrl(objectKey));
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok || response.body === null) return refuse(response, 'a read');
      return response.body;
    },

    async head(objectKey) {
      const response = await call('HEAD', objectUrl(objectKey));
      if (response.status === 404) return null;
      if (!response.ok) return refuse(response, 'a read');
      const modified = new Date(response.headers.get('last-modified') ?? '');
      // An object whose age is unknown is treated as new, so the sweep keeps it.
      return Number.isNaN(modified.getTime()) ? now() : modified;
    },

    async delete(objectKey) {
      const response = await call('DELETE', objectUrl(objectKey));
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) await refuse(response, 'a delete');
    },

    async *list(prefix) {
      if (!PREFIX.test(prefix)) throw new SafeError('Storage was given a prefix that is not ours.');
      let token: string | undefined;
      do {
        const response = await call(
          'GET',
          bucketUrl({
            'list-type': '2',
            prefix,
            ...(token === undefined ? {} : { 'continuation-token': token }),
          }),
        );
        if (!response.ok) return refuse(response, 'a list');
        const xml = await response.text();
        for (const [, found] of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
          if (found !== undefined && found.startsWith(prefix)) yield found;
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
          ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1]
          : undefined;
      } while (token !== undefined);
    },

    async versioned() {
      const response = await call('GET', bucketUrl({ versioning: '' }));
      if (!response.ok) return refuse(response, 'a read');
      return /<Status>(?:Enabled|Suspended)<\/Status>/.test(await response.text());
    },
  };
}

/** The file service's storage: the write key puts and the read key gets, `clean/` objects only. */
export function createStorage(
  settings: Where,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Storage {
  const writer = objectClient(settings, settings.write, [CLEAN_KEY], fetchImpl, now);
  const reader = objectClient(settings, settings.read, [CLEAN_KEY], fetchImpl, now);
  return { put: (key, bytes) => writer.put(key, bytes), get: (key) => reader.get(key) };
}

/** The scanner's key: reads `clean/` and `withheld/`, and writes `withheld/` only. */
export function createScannerStorage(
  settings: Where,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Storage {
  const reads = objectClient(settings, settings.scanner, [CLEAN_KEY, WITHHELD_KEY], fetchImpl, now);
  const writes = objectClient(settings, settings.scanner, [WITHHELD_KEY], fetchImpl, now);
  return { get: (key) => reads.get(key), put: (key, bytes) => writes.put(key, bytes) };
}

/** The worker's removal key: lists, heads and deletes under `clean/` and `withheld/`. */
export function createRemovalStorage(
  settings: Where,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Pick<ObjectClient, 'head' | 'delete' | 'list' | 'versioned'> {
  if (settings.removal === undefined) throw new SafeError('The removal key is not set.');
  return objectClient(settings, settings.removal, [CLEAN_KEY, WITHHELD_KEY], fetchImpl, now);
}

/** All of a stream, or null if it is longer than `max` bytes. */
export async function readAll(
  stream: ReadableStream<Uint8Array>,
  max: number = MAX_FILE_BYTES,
): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > max) {
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
