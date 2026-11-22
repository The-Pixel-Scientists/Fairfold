// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { downloadList, LIST_URL, readListUrl } from './download.ts';

const url = new URL('https://lists.example.test/list.json');
const limits = { bytes: 64, ms: 1_000 };
const json = { 'content-type': 'application/json' };

const answer = (
  body: ConstructorParameters<typeof Response>[0],
  init: ResponseInit = { headers: json },
) => (() => Promise.resolve(new Response(body, init))) as typeof fetch;

describe('downloadList', () => {
  it('returns the text with the SHA-256 of the bytes', async () => {
    expect(await downloadList(answer('{"a":1}'), url, limits)).toEqual({
      ok: true,
      body: '{"a":1}',
      sha256: createHash('sha256').update('{"a":1}').digest(),
    });
  });

  it('asks for the configured address with a GET and a time limit', async () => {
    let seen: { input: unknown; init: RequestInit | undefined } | undefined;
    const fetcher = ((input, init) => {
      seen = { input, init };
      return Promise.resolve(new Response('{}', { headers: json }));
    }) as typeof fetch;
    await downloadList(fetcher, url, limits);
    expect(seen?.input).toBe(url);
    expect(seen?.init?.method).toBe('GET');
    expect(seen?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a body over the cap', async () => {
    expect(await downloadList(answer('x'.repeat(65)), url, limits)).toEqual({
      ok: false,
      failure: 'list_refused',
    });
  });

  it('refuses a file that is not JSON, or not UTF-8', async () => {
    const html = answer('<html>', { headers: { 'content-type': 'text/html' } });
    expect(await downloadList(html, url, limits)).toEqual({ ok: false, failure: 'list_refused' });
    const bytes = answer(new Uint8Array([0xff, 0xfe, 0x7b]), { headers: json });
    expect(await downloadList(bytes, url, limits)).toEqual({ ok: false, failure: 'list_refused' });
  });

  it('reports an error status or a failed connection as unavailable, with nothing from either', async () => {
    expect(await downloadList(answer('x', { status: 503 }), url, limits)).toEqual({
      ok: false,
      failure: 'list_unavailable',
    });
    const refusedConnection = (() =>
      Promise.reject(new Error('connect to 10.0.0.1 refused'))) as typeof fetch;
    const result = await downloadList(refusedConnection, url, limits);
    expect(result).toEqual({ ok: false, failure: 'list_unavailable' });
    expect(JSON.stringify(result)).not.toContain('10.0.0.1');
  });
});

describe('readListUrl', () => {
  it('is undefined when no address is set', () => {
    expect(readListUrl({})).toBeUndefined();
  });

  it('accepts an https address', () => {
    expect(readListUrl({ [LIST_URL]: 'https://lists.example.test/list.json' })?.host).toBe(
      'lists.example.test',
    );
  });

  it.each(['http://lists.example.test/x', 'https://user:pw@lists.example.test/x', 'nonsense'])(
    'stops start-up for %s, naming the variable and not the value',
    (value) => {
      const message = (() => {
        try {
          readListUrl({ [LIST_URL]: value });
        } catch (error) {
          return (error as Error).message;
        }
        return '';
      })();
      expect(message).toContain(LIST_URL);
      expect(message).not.toContain('pw@');
    },
  );
});
