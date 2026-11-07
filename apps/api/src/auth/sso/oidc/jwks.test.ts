// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A provider's signing keys (ADR 0010, "SSO"): which key fits a header, and
// when the set is fetched again.

import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { JwksCache } from './jwks.ts';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
type Jwk = Record<string, string>;
const jwk = (key: KeyObject, kid: string, extra: Jwk = {}): Jwk => ({
  ...(key.export({ format: 'jwk' }) as Jwk),
  kid,
  ...extra,
});
const JWKS = { keys: [jwk(rsa, 'rsa-1', { use: 'sig' }), jwk(ec, 'ec-1')] };

const lookupIn = (jwks: unknown) => new JwksCache(() => Promise.resolve(jwks)).lookup('p', 'u');

describe('JWKS key choice', () => {
  it('gives the named key for an algorithm it fits', async () => {
    const keys = lookupIn(JWKS);
    expect((await keys('rsa-1', 'RS256'))?.equals(rsa)).toBe(true);
    expect((await keys('rsa-1', 'PS256'))?.equals(rsa)).toBe(true);
    expect((await keys('ec-1', 'ES256'))?.equals(ec)).toBe(true);
  });

  it('uses no key whose alg, use, type, curve or size disagrees', async () => {
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey;
    const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey;
    const cases: [Jwk, 'RS256' | 'ES256'][] = [
      [jwk(rsa, 'k', { alg: 'PS256' }), 'RS256'],
      [jwk(rsa, 'k', { use: 'enc' }), 'RS256'],
      [jwk(ec, 'k'), 'RS256'],
      [jwk(rsa, 'k'), 'ES256'],
      [jwk(weak, 'k'), 'RS256'],
      [jwk(p384, 'k'), 'ES256'],
      [{ kty: 'oct', kid: 'k', k: 'c2VjcmV0' }, 'RS256'],
    ];
    for (const [key, alg] of cases)
      expect(await lookupIn({ keys: [key] })('k', alg)).toBeUndefined();
  });

  it('refuses a kid that names two keys', async () => {
    expect(await lookupIn({ keys: [jwk(rsa, 'k'), jwk(rsa, 'k')] })('k', 'RS256')).toBeUndefined();
  });

  it('takes the only fitting key when the header names none, and none when several fit', async () => {
    expect((await lookupIn(JWKS)(undefined, 'RS256'))?.equals(rsa)).toBe(true);
    const two = { keys: [...JWKS.keys, jwk(rsa, 'rsa-2')] };
    expect(await lookupIn(two)(undefined, 'RS256')).toBeUndefined();
  });

  it('skips entries that are not keys, and throws for a document that is not a key set', async () => {
    expect(await lookupIn({ keys: [null, 'x', ...JWKS.keys] })('ec-1', 'ES256')).toBeDefined();
    await expect(lookupIn({ keys: 'none' })('rsa-1', 'RS256')).rejects.toThrow();
    const failing = new JwksCache(() => Promise.reject(new Error('refused'))).lookup('p', 'u');
    await expect(failing('rsa-1', 'RS256')).rejects.toThrow();
  });
});

describe('JwksCache', () => {
  it('fetches each provider’s keys once for 5 minutes', async () => {
    let now = 0;
    const fetch = vi.fn(() => Promise.resolve(JWKS));
    const cache = new JwksCache(fetch, () => now);
    const keys = cache.lookup('p', 'https://idp.example.org/jwks');
    await keys('rsa-1', 'RS256');
    await keys('ec-1', 'ES256');
    expect(fetch).toHaveBeenCalledTimes(1);
    await cache.lookup('q', 'https://idp.example.org/jwks')('rsa-1', 'RS256');
    expect(fetch).toHaveBeenCalledTimes(2);
    now = 300_000;
    await keys('rsa-1', 'RS256');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('refetches once for an unknown kid, and not for a key that does not fit', async () => {
    const fetch = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ keys: [jwk(rsa, 'old')] })
      .mockResolvedValue(JWKS);
    const keys = new JwksCache(fetch).lookup('p', 'u');
    expect(await keys('old', 'RS256')).toBeDefined();
    expect(await keys('rsa-1', 'RS256')).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);

    expect(await keys('gone', 'RS256')).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(await keys('ec-1', 'RS256')).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
