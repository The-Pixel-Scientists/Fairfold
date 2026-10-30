// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Signs one S3 request with the AWS signer from `@smithy/signature-v4` (ADR 0047).
// This is the only place the storage keys are used. A wrong signature is
// refused by storage, so a mistake here fails closed.

import { createHash, createHmac } from 'node:crypto';

import { SignatureV4 } from '@smithy/signature-v4';

import type { StorageKey } from './settings.ts';

export const sha256Hex = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

type Chunk = string | ArrayBuffer | ArrayBufferView;

/** The hash the signer asks for: SHA-256, or HMAC-SHA-256 when given a secret. */
class Sha256 {
  readonly #hash: ReturnType<typeof createHash | typeof createHmac>;

  constructor(secret?: Chunk) {
    this.#hash =
      secret === undefined ? createHash('sha256') : createHmac('sha256', toBytes(secret));
  }

  update(data: Chunk): void {
    this.#hash.update(toBytes(data));
  }

  digest(): Promise<Uint8Array> {
    return Promise.resolve(this.#hash.digest());
  }

  reset(): void {
    throw new Error('A hash is used once.');
  }
}

const toBytes = (data: Chunk): string | Uint8Array =>
  typeof data === 'string'
    ? data
    : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);

export interface SignInput {
  readonly method: 'GET' | 'PUT';
  readonly url: URL;
  readonly region: string;
  readonly key: StorageKey;
  /** Hex SHA-256 of the body: of the empty string for a GET. */
  readonly payloadHash: string;
  readonly now: Date;
  /** Headers to sign besides host, `x-amz-content-sha256` and `x-amz-date`. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** The headers to send: those signed, and `authorization`. */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const { method, url, region, key } = input;
  const signer = new SignatureV4({
    service: 's3',
    region,
    sha256: Sha256,
    uriEscapePath: false,
    credentials: {
      accessKeyId: key.accessKeyId,
      secretAccessKey: key.secretAccessKey.reveal(),
    },
  });
  const signed = await signer.sign(
    {
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port === '' ? undefined : Number(url.port),
      path: url.pathname,
      query: {},
      headers: {
        ...input.headers,
        host: url.host,
        'x-amz-content-sha256': input.payloadHash,
      },
    },
    { signingDate: input.now },
  );
  return Object.fromEntries(Object.entries(signed.headers).filter(([name]) => name !== 'host'));
}
