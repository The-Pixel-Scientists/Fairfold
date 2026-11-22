// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One GET of the sanctions list (ADR 0031, ADR 0010). The `fetcher` is the
// client apps/api pins to the list's configured host: it checks addresses at
// connect time, speaks HTTPS only and follows at most 3 redirects, each to a
// configured host. This module makes no client of its own and reads no proxy
// settings. It adds the download's own limits, 64 MB and 5 minutes, and
// hashes the bytes it kept. Every outcome is a code; nothing from the
// request, the response or an error (which can carry the address) is kept,
// and the file itself is never stored.

import { readSetting, type Env } from '@pixel-scientists/db';

export const MAX_BODY_BYTES = 64 * 1024 * 1024;
export const TIMEOUT_MS = 5 * 60 * 1000;
export const LIST_URL = 'TPS_SANCTIONS_LIST_URL';

export type Downloaded =
  | { readonly ok: true; readonly body: string; readonly sha256: Buffer }
  | { readonly ok: false; readonly failure: 'list_unavailable' | 'list_refused' };

export type Fetcher = typeof fetch;

/** The configured address, or undefined when this deployment has none. Anything but plain HTTPS stops start-up. */
export function readListUrl(env: Env): URL | undefined {
  if (!env[LIST_URL]) return undefined;
  let url: URL;
  try {
    url = new URL(readSetting(env, LIST_URL));
  } catch {
    throw new Error(`${LIST_URL} must be an https:// address.`);
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error(`${LIST_URL} must be an https:// address with no user name.`);
  }
  return url;
}

/** The response's bytes, or why there are none. */
async function readBytes(
  fetcher: Fetcher,
  url: URL,
  limits: { readonly bytes: number; readonly ms: number },
): Promise<Buffer | 'list_unavailable' | 'list_refused'> {
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(limits.ms),
    });
    if (!response.ok) return 'list_unavailable';
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
      return 'list_refused';
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > limits.bytes) return 'list_refused';
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    return 'list_unavailable';
  }
}

export async function downloadList(
  fetcher: Fetcher,
  url: URL,
  limits: { readonly bytes: number; readonly ms: number } = {
    bytes: MAX_BODY_BYTES,
    ms: TIMEOUT_MS,
  },
): Promise<Downloaded> {
  const bytes = await readBytes(fetcher, url, limits);
  if (typeof bytes === 'string') return { ok: false, failure: bytes };
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    return { ok: true, body, sha256: Buffer.from(digest) };
  } catch {
    return { ok: false, failure: 'list_refused' };
  }
}
