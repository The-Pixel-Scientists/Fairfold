// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which key pair may touch which prefix (ADR 0030, "Keys and bucket"), against a
// fake fetch. The refusals by SeaweedFS itself need the development store.

import { describe, expect, it } from 'vitest';

import { Secret } from '../../config.ts';
import { createRemovalStorage, createScannerStorage, createStorage, readAll } from './storage.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const FILE = '33333333-3333-4333-8333-333333333333';
const KEY = `clean/${TENANT}/${FILE}`;
const WITHHELD = `withheld/${TENANT}/${FILE}`;

const key = (accessKeyId: string) => ({
  accessKeyId,
  secretAccessKey: new Secret(`${accessKeyId}-secret`),
});
const settings = {
  endpoint: new URL('http://127.0.0.1:8333'),
  region: 'us-east-1',
  bucket: 'tps-files',
  write: key('writer'),
  read: key('reader'),
  scanner: key('scanner'),
  removal: key('remover'),
};
const NOW = () => new Date('2026-10-21T10:13:55Z');

interface Call {
  url: string;
  init: RequestInit;
}

function recorder(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = ((url: URL, init: RequestInit) => {
    const call = { url: url.href, init };
    calls.push(call);
    return Promise.resolve(respond(call));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const credential = (call: Call | undefined) =>
  /Credential=([^/]+)\//.exec(new Headers(call?.init.headers).get('authorization') ?? '')?.[1];

describe('the scanner key', () => {
  it('reads clean/ and withheld/, writes withheld/ only', async () => {
    const { calls, fetchImpl } = recorder(() => new Response('x'));
    const scanner = createScannerStorage(settings, fetchImpl, NOW);
    await scanner.put(WITHHELD, Buffer.from('x'));
    await scanner.get(WITHHELD);
    await scanner.get(KEY);
    expect(calls.map(credential)).toEqual(['scanner', 'scanner', 'scanner']);
    await expect(scanner.put(KEY, Buffer.from('x'))).rejects.toThrow('not ours');
    expect(calls).toHaveLength(3);
  });
});

describe('the upload and download keys', () => {
  it('stay on clean/: withheld/ is refused before any call', async () => {
    const { calls, fetchImpl } = recorder(() => new Response('x'));
    const storage = createStorage(settings, fetchImpl, NOW);
    await expect(storage.get(WITHHELD)).rejects.toThrow('not ours');
    await expect(storage.put(WITHHELD, Buffer.from('x'))).rejects.toThrow('not ours');
    expect(calls).toEqual([]);
  });
});

describe('the removal key', () => {
  it('heads, deletes and lists, with the query signed, and refuses other keys and prefixes', async () => {
    const listing = `<R><Key>${KEY}</Key><Key>other/x</Key><IsTruncated>false</IsTruncated></R>`;
    const { calls, fetchImpl } = recorder(({ init }) => {
      if (init.method === 'HEAD') {
        return new Response(null, {
          headers: { 'last-modified': 'Wed, 21 Oct 2026 08:00:00 GMT' },
        });
      }
      return init.method === 'GET' ? new Response(listing) : new Response(null, { status: 204 });
    });
    const removal = createRemovalStorage(settings, fetchImpl, NOW);
    expect(await removal.head(KEY)).toEqual(new Date('2026-10-21T08:00:00Z'));
    await removal.delete(WITHHELD);
    const listed: string[] = [];
    for await (const found of removal.list(`clean/${TENANT}/`)) listed.push(found);
    expect(listed).toEqual([KEY]);
    expect(calls.map(credential)).toEqual(['remover', 'remover', 'remover']);
    expect(calls[2]?.url).toContain('list-type=2&prefix=clean%2F');
    await expect(removal.delete('clean/x')).rejects.toThrow('not ours');
    await expect(removal.list('clean/').next()).rejects.toThrow('not ours');
  });

  it('reads a missing object as null and an object of unknown age as new', async () => {
    const missing = recorder(() => new Response(null, { status: 404 }));
    expect(await createRemovalStorage(settings, missing.fetchImpl, NOW).head(KEY)).toBeNull();
    const unknown = recorder(() => new Response(null));
    expect(await createRemovalStorage(settings, unknown.fetchImpl, NOW).head(KEY)).toEqual(NOW());
  });

  it('reports versioning enabled or suspended, and refuses to exist without the key', async () => {
    for (const status of ['Enabled', 'Suspended']) {
      const { fetchImpl } = recorder(() => new Response(`<V><Status>${status}</Status></V>`));
      expect(await createRemovalStorage(settings, fetchImpl, NOW).versioned()).toBe(true);
    }
    const { fetchImpl } = recorder(() => new Response('<V/>'));
    expect(await createRemovalStorage(settings, fetchImpl, NOW).versioned()).toBe(false);
    expect(() => createRemovalStorage({ ...settings, removal: undefined })).toThrow('not set');
  });
});

describe('readAll', () => {
  it('reads a stream, or gives up past the limit', async () => {
    const stream = () => new Response('abcdef').body as ReadableStream<Uint8Array>;
    expect((await readAll(stream(), 6))?.toString()).toBe('abcdef');
    expect(await readAll(stream(), 5)).toBeNull();
  });
});
