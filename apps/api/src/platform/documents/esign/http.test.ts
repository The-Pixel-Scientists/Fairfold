// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The adapter HTTP helper (ADR 0040, ADR 0010): HTTPS only, no credentials in
// the URL, the one configured host for a pinned provider, no redirect, a byte
// cap, and the global dispatcher's refusal of private and metadata addresses.

import { fetch as undiciFetch } from 'undici';
import { describe, expect, it } from 'vitest';

import { createOutboundDispatcher } from '../../../outbound/dispatcher.ts';
import { AdapterHttpError, createAdapterHttp } from './http.ts';

const get = { method: 'GET' } as const;
const neverReached = () => Promise.reject(new Error('reached'));

/** The code of the refusal at the bottom of an error's causes. */
function rootCode(error: unknown): unknown {
  let current = error as { code?: unknown; cause?: unknown } | undefined;
  while (current?.cause !== undefined) current = current.cause as typeof current;
  return current?.code;
}

async function refusal(promise: Promise<unknown>): Promise<AdapterHttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdapterHttpError) return error;
    throw error;
  }
  throw new Error('The call was not refused.');
}

describe('the adapter HTTP helper', () => {
  it.each(['http://signing.example.org/api', 'ftp://signing.example.org/', 'not a url'])(
    'refuses %s',
    async (url) => {
      const call = createAdapterHttp({ fetch: neverReached });
      expect((await refusal(call(url, get, 1024))).code).toBe('url_refused');
    },
  );

  it('refuses credentials in the URL', async () => {
    const call = createAdapterHttp({ fetch: neverReached });
    const error = await refusal(call('https://user:secret@signing.example.org/', get, 1024));
    expect(error.code).toBe('url_refused');
  });

  it.each(['169.254.169.254', '10.0.0.5', '127.0.0.1', '192.168.1.1', 'fd00::1', '::1'])(
    'refuses a host that resolves to %s, through the global dispatcher',
    async (address) => {
      const dispatcher = createOutboundDispatcher({ resolve: () => Promise.resolve([address]) });
      const call = createAdapterHttp({
        fetch: (input, init) => undiciFetch(input, { ...init, dispatcher }),
      });
      const error = await refusal(call('https://signing.example.org/api', get, 1024));
      expect(error.code).toBe('unreachable');
      expect(rootCode(error)).toBe('address_refused');
    },
  );

  it('pins a private provider to its one host, port and scheme', async () => {
    const reached: string[] = [];
    const call = createAdapterHttp({
      pinned: new URL('https://sign.internal:8443'),
      fetch: ((input: URL) => {
        reached.push(String(input));
        return Promise.resolve(new Response('{}'));
      }) as unknown as typeof fetch,
    });
    for (const url of [
      'https://other.internal:8443/api',
      'https://sign.internal/api',
      'https://sign.internal:8443.evil.test/api',
    ]) {
      expect((await refusal(call(url, get, 1024))).code, url).toBe('url_refused');
    }
    expect((await call('https://sign.internal:8443/api', get, 1024)).status).toBe(200);
    expect(reached).toEqual(['https://sign.internal:8443/api']);
    expect(() => createAdapterHttp({ pinned: new URL('http://sign.internal') })).toThrow(
      AdapterHttpError,
    );
  });

  it('follows no redirect and refuses a reply over the cap', async () => {
    let init: RequestInit | undefined;
    const call = createAdapterHttp({
      fetch: ((_input: URL, options?: RequestInit) => {
        init = options;
        return Promise.resolve(new Response(new Uint8Array(11)));
      }) as unknown as typeof fetch,
    });
    expect((await refusal(call('https://signing.example.org/', get, 10))).code).toBe('too_large');
    expect(init?.redirect).toBe('error');
  });

  it('never repeats the URL or the reply in an error', async () => {
    const call = createAdapterHttp({
      fetch: (() =>
        Promise.reject(
          new Error('https://signing.example.org/secret-path token=abc'),
        )) as unknown as typeof fetch,
    });
    const error = await refusal(call('https://signing.example.org/secret-path', get, 10));
    expect(error.message).not.toMatch(/secret|token|signing\.example/);
  });
});
