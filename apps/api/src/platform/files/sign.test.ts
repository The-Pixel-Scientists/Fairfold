// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { Secret } from '../../config.ts';
import { sha256Hex, signRequest } from './sign.ts';

const key = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: new Secret('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'),
};

describe('signRequest', () => {
  // AWS's documented example, "GET Object" with a Range header, in
  // "Signature Calculations for the Authorization Header".
  it('signs the request AWS documents with the signature AWS documents', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      region: 'us-east-1',
      key,
      payloadHash: sha256Hex(''),
      now: new Date('2013-05-24T00:00:00Z'),
      headers: { Range: 'bytes=0-9' },
    });
    expect(headers['authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  // The shape of a put to the development store: three signed headers, no
  // host header (fetch adds it), and the payload hash as sent.
  it('signs a put with the host, the payload hash and the date', async () => {
    const payloadHash = sha256Hex('%PDF-1.7');
    const headers = await signRequest({
      method: 'PUT',
      url: new URL('http://127.0.0.1:8333/tps-files/clean/t/f'),
      region: 'us-east-1',
      key,
      payloadHash,
      now: new Date('2026-10-21T10:13:55.123Z'),
    });
    expect(Object.keys(headers).sort()).toEqual([
      'authorization',
      'x-amz-content-sha256',
      'x-amz-date',
    ]);
    expect(headers['x-amz-date']).toBe('20261021T101355Z');
    expect(headers['x-amz-content-sha256']).toBe(payloadHash);
    expect(headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20261021\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('never puts the secret in what it returns', async () => {
    const headers = await signRequest({
      method: 'GET',
      url: new URL('http://127.0.0.1:8333/b/k'),
      region: 'us-east-1',
      key,
      payloadHash: sha256Hex(''),
      now: new Date(),
    });
    expect(JSON.stringify(headers)).not.toContain('wJalrXUtnFEMI');
  });
});
