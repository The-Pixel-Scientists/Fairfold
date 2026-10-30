// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The object store against a fake fetch: which key signs which call, where
// the call goes, and what is refused.

import { describe, expect, it } from 'vitest';

import { Secret } from '../../config.ts';
import { sha256Hex } from './sign.ts';
import { createStorage } from './storage.ts';

const TENANT = '11111111-1111-4111-8111-111111111111';
const FILE = '33333333-3333-4333-8333-333333333333';
const KEY = `clean/${TENANT}/${FILE}`;

const settings = {
  endpoint: new URL('http://127.0.0.1:8333'),
  region: 'us-east-1',
  bucket: 'tps-files',
  write: { accessKeyId: 'writer', secretAccessKey: new Secret('write-secret-key') },
  read: { accessKeyId: 'reader', secretAccessKey: new Secret('read-secret-key') },
};

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: () => Response) {
  const calls: Call[] = [];
  const fetchImpl = ((url: URL, init: RequestInit) => {
    calls.push({ url: url.href, init });
    return Promise.resolve(respond());
  }) as unknown as typeof fetch;
  const storage = createStorage(settings, fetchImpl, () => new Date('2026-10-21T10:13:55Z'));
  return { calls, storage };
}

const credential = (call: Call | undefined) =>
  /Credential=([^/]+)\//.exec(new Headers(call?.init.headers).get('authorization') ?? '')?.[1];

describe('storage', () => {
  it('puts with the write key, path-style, signed, and never follows a redirect', async () => {
    const { calls, storage } = fakeFetch(() => new Response(null, { status: 200 }));
    const bytes = Buffer.from('%PDF-1.7');
    await storage.put(KEY, bytes);

    const [call] = calls;
    expect(call?.url).toBe(`http://127.0.0.1:8333/tps-files/${KEY}`);
    expect(call?.init.method).toBe('PUT');
    expect(call?.init.redirect).toBe('error');
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(call?.init.body).toBe(bytes);
    expect(credential(call)).toBe('writer');
    const headers = new Headers(call?.init.headers);
    expect(headers.get('x-amz-content-sha256')).toBe(sha256Hex(bytes));
    expect(headers.get('x-amz-date')).toBe('20261021T101355Z');
    expect(headers.get('authorization')).toContain(
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date',
    );
  });

  it('gets with the read key and returns the stream', async () => {
    const { calls, storage } = fakeFetch(() => new Response('bytes', { status: 200 }));
    const body = await storage.get(KEY);
    expect(await new Response(body).text()).toBe('bytes');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.redirect).toBe('error');
    expect(credential(calls[0])).toBe('reader');
  });

  it('reads a missing object as null, and refuses any other answer', async () => {
    expect(await fakeFetch(() => new Response('', { status: 404 })).storage.get(KEY)).toBeNull();
    const refused = fakeFetch(() => new Response('<Error>secret detail</Error>', { status: 403 }));
    const error = await refused.storage.get(KEY).catch((e: unknown) => e);
    expect((error as Error).message).toBe('Storage refused a read with status 403.');
    const put = fakeFetch(() => new Response('', { status: 500 }));
    await expect(put.storage.put(KEY, Buffer.from('x'))).rejects.toThrow('status 500');
  });

  it('says nothing about the endpoint or keys when it cannot connect', async () => {
    const storage = createStorage(settings, () => Promise.reject(new TypeError('fetch failed')));
    const error = await storage.get(KEY).catch((e: unknown) => e);
    expect((error as Error).message).toBe('Storage could not be reached.');
  });

  it('refuses a key that is not one of ours, before any call', async () => {
    const { calls, storage } = fakeFetch(() => new Response(null));
    for (const key of [
      `quarantine/${TENANT}/${FILE}`,
      `clean/${TENANT}/${FILE}/../x`,
      `clean/${TENANT}/Accounts.pdf`,
      `clean/${TENANT}`,
      `../clean/${TENANT}/${FILE}`,
      '',
    ]) {
      await expect(storage.get(key), key).rejects.toThrow('not ours');
      await expect(storage.put(key, Buffer.from('x')), key).rejects.toThrow('not ours');
    }
    expect(calls).toEqual([]);
  });
});
