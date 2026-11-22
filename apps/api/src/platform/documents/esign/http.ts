// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one way an adapter makes an HTTP call (ADR 0040, "Outbound", ADR 0010).
// A provider at a public address goes through the global fetch, whose
// dispatcher refuses plain HTTP, private and metadata addresses and more than
// three redirects; a self-hosted provider on a private network goes through a
// client pinned to the one host and port the cell's configuration names. Both
// are HTTPS only, follow no redirect, answer within a time limit and are read
// up to a byte cap. An error holds a code and never the URL, a header or the
// provider's reply.

import { MAX_FILE_BYTES } from '@pixel-scientists/domain/files';

import { pinnedFetch } from '../../../outbound/pinned.ts';
import { SafeError } from '../../../serialize-error.ts';

const CODES = {
  url_refused: 'An adapter call must use an https URL with no credentials, on the configured host.',
  unreachable: 'The signing provider could not be reached.',
  too_large: 'The signing provider sent more than the limit.',
} as const;

export type AdapterHttpCode = keyof typeof CODES;

export class AdapterHttpError extends SafeError {
  readonly code: AdapterHttpCode;

  constructor(code: AdapterHttpCode, options?: ErrorOptions) {
    super(CODES[code], options);
    this.name = 'AdapterHttpError';
    this.code = code;
  }
}

/** A JSON reply; the signed file and evidence use MAX_FILE_BYTES. */
export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = MAX_FILE_BYTES;
/** Two minutes for a download, as ADR 0040 allows. */
const CALL_TIMEOUT_MS = 120_000;

export interface AdapterHttpOptions {
  /** The cell's one configured host for a private self-hosted provider. Absent for a public provider. */
  readonly pinned?: URL;
  /** Replaces the transport. For tests. */
  readonly fetch?: typeof fetch;
}

export interface AdapterReply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

export type AdapterCall = (
  url: string,
  init: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Readonly<Record<string, string>>;
    body?: Uint8Array;
  },
  maxBytes: number,
) => Promise<AdapterReply>;

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) throw new AdapterHttpError('too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createAdapterHttp(options: AdapterHttpOptions = {}): AdapterCall {
  const { pinned } = options;
  if (pinned !== undefined && pinned.protocol !== 'https:')
    throw new AdapterHttpError('url_refused');
  const transport = options.fetch ?? (pinned === undefined ? fetch : pinnedFetch(pinned));
  return async (url, init, maxBytes) => {
    const target = URL.parse(url);
    if (
      target === null ||
      target.protocol !== 'https:' ||
      target.username !== '' ||
      target.password !== '' ||
      (pinned !== undefined && target.origin !== pinned.origin)
    ) {
      throw new AdapterHttpError('url_refused');
    }
    try {
      const response = await transport(target, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      return {
        status: response.status,
        headers: response.headers,
        body: await readCapped(response, maxBytes),
      };
    } catch (error) {
      throw error instanceof AdapterHttpError
        ? error
        : new AdapterHttpError('unreachable', { cause: error });
    }
  };
}
