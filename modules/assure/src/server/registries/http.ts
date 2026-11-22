// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One GET to a register's API (ADR 0031, ADR 0010). The global fetch is the
// dispatcher's: it checks addresses, caps redirects and the body. This adds
// shorter limits of its own and never follows a redirect, since a key in a
// header must not travel on. Every outcome is a code; nothing from the
// request, the response or an error (which can carry the address and the
// headers) is kept.

import type { LookupFailure } from '../../contracts/index.ts';

/** Within the dispatcher's 30 seconds. */
export const TIMEOUT_MS = 10_000;
/** Within the dispatcher's 1 MB. */
export const MAX_BODY_BYTES = 512 * 1024;

export type Fetched =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly failure: LookupFailure };

export type Fetcher = typeof fetch;

const refused: Fetched = { ok: false, failure: 'response_refused' };
const unavailable: Fetched = { ok: false, failure: 'registry_unavailable' };

/** The body as text, or null when it passes `limit` bytes. */
async function readCapped(response: Response, limit: number): Promise<string | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** `url` is built by the caller from a fixed host and a checked identifier. */
export async function getJson(
  fetcher: Fetcher,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<Fetched> {
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { ...headers, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return { ok: false, failure: 'not_found' };
    if (response.status === 429) return { ok: false, failure: 'rate_limited' };
    if (!response.ok) return unavailable;
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
      return refused;
    }
    const text = await readCapped(response, MAX_BODY_BYTES);
    if (text === null) return refused;
    try {
      return { ok: true, body: JSON.parse(text) as unknown };
    } catch {
      return refused;
    }
  } catch {
    return unavailable;
  }
}
