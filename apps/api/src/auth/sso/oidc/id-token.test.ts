// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ID token checks against a local in-process issuer with generated keys
// (ADR 0010, "SSO" and "Tests"): the algorithm allowlist before any key
// lookup, the signature, issuer, audience, azp, times, nonce and auth_time.

import { constants, createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { IdTokenRefused, verifyIdToken } from './id-token.ts';
import { JwksCache, type KeyLookup } from './jwks.ts';

const ISSUER = 'https://idp.example.org/tenant-a';
const CLIENT = 'client-a';
const NONCE = 'n'.repeat(43);
const NOW = 2_000_000_000;

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
type Jwk = Record<string, string>;
const jwk = (key: KeyObject, kid: string, extra: Jwk = {}): Jwk => ({
  ...(key.export({ format: 'jwk' }) as Jwk),
  kid,
  use: 'sig',
  ...extra,
});
const JWKS = { keys: [jwk(rsa.publicKey, 'rsa-1'), jwk(ec.publicKey, 'ec-1')] };

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = { alg: 'RS256', kid: 'rsa-1' },
): string {
  const body = {
    iss: ISSUER,
    sub: 'subject-1',
    aud: CLIENT,
    exp: NOW + 300,
    iat: NOW,
    nonce: NONCE,
    ...claims,
  };
  const data = `${encode(header)}.${encode(body)}`;
  const bytes = Buffer.from(data);
  const signature =
    header.alg === 'ES256'
      ? sign('sha256', bytes, { key: ec.privateKey, dsaEncoding: 'ieee-p1363' })
      : header.alg === 'PS256'
        ? sign('sha256', bytes, {
            key: rsa.privateKey,
            padding: constants.RSA_PKCS1_PSS_PADDING,
            saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
          })
        : header.alg === 'RS256'
          ? sign('sha256', bytes, rsa.privateKey)
          : header.alg === 'HS256'
            ? createHmac('sha256', String(JWKS.keys[0]?.n)).update(bytes).digest()
            : Buffer.alloc(0);
  return `${data}.${signature.toString('base64url')}`;
}

const keysFrom = (jwks: unknown) => new JwksCache(() => Promise.resolve(jwks)).lookup('p', 'u');
const expected = { issuer: ISSUER, clientId: CLIENT, nonce: NONCE, now: NOW };

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(IdTokenRefused);
  return (error as IdTokenRefused).reason;
}

describe('verifyIdToken', () => {
  it.each(['RS256', 'PS256', 'ES256'])('accepts %s from the provider’s keys', async (alg) => {
    const kid = alg === 'ES256' ? 'ec-1' : 'rsa-1';
    const claims = await verifyIdToken(token({}, { alg, kid }), expected, keysFrom(JWKS));
    expect(claims.sub).toBe('subject-1');
  });

  it.each(['none', 'HS256', 'RS512', 'EdDSA'])(
    'refuses %s before looking up a key',
    async (alg) => {
      const keys = vi.fn<KeyLookup>();
      const reason = await refusal(verifyIdToken(token({}, { alg, kid: 'rsa-1' }), expected, keys));
      expect(reason).toBe('algorithm_refused');
      expect(keys).not.toHaveBeenCalled();
    },
  );

  it('refuses a token that is not three base64url parts', async () => {
    for (const bad of ['a.b', 'a.b.c.d', 'a.b+.c', `${'a'.repeat(16_400)}.b.c`]) {
      expect(await refusal(verifyIdToken(bad, expected, keysFrom(JWKS)))).toBe('token_malformed');
    }
  });

  it('refuses a changed payload or a signature by another key', async () => {
    const [header, , signature] = token().split('.');
    const forged = `${String(header)}.${encode({ sub: 'someone-else' })}.${String(signature)}`;
    expect(await refusal(verifyIdToken(forged, expected, keysFrom(JWKS)))).toBe(
      'signature_invalid',
    );
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
    const keys = keysFrom({ keys: [jwk(other, 'rsa-1')] });
    expect(await refusal(verifyIdToken(token(), expected, keys))).toBe('signature_invalid');
  });

  it('compares the issuer exactly', async () => {
    for (const iss of [`${ISSUER}/`, 'https://idp.example.org/tenant-b', ISSUER.toUpperCase()]) {
      expect(await refusal(verifyIdToken(token({ iss }), expected, keysFrom(JWKS)))).toBe(
        'issuer_mismatch',
      );
    }
  });

  it('needs our client id in aud, and as azp when present or with several audiences', async () => {
    const keys = keysFrom(JWKS);
    for (const claims of [
      { aud: 'client-b' },
      { aud: ['client-b'] },
      { aud: [CLIENT, 'client-b'] },
      { aud: [CLIENT, 'client-b'], azp: 'client-b' },
      { aud: CLIENT, azp: 'client-b' },
    ]) {
      expect(await refusal(verifyIdToken(token(claims), expected, keys))).toBe('audience_mismatch');
    }
    await expect(
      verifyIdToken(token({ aud: [CLIENT, 'client-b'], azp: CLIENT }), expected, keys),
    ).resolves.toBeDefined();
  });

  it('allows at most 60 seconds of clock skew on exp and iat', async () => {
    const keys = keysFrom(JWKS);
    await expect(verifyIdToken(token({ exp: NOW - 60 }), expected, keys)).resolves.toBeDefined();
    expect(await refusal(verifyIdToken(token({ exp: NOW - 61 }), expected, keys))).toBe(
      'token_expired',
    );
    await expect(verifyIdToken(token({ iat: NOW + 60 }), expected, keys)).resolves.toBeDefined();
    expect(await refusal(verifyIdToken(token({ iat: NOW + 61 }), expected, keys))).toBe(
      'issued_in_future',
    );
  });

  it('refuses a missing nonce, or one from another flow (a reused nonce)', async () => {
    const keys = keysFrom(JWKS);
    expect(await refusal(verifyIdToken(token({ nonce: undefined }), expected, keys))).toBe(
      'nonce_mismatch',
    );
    const next = { ...expected, nonce: 'm'.repeat(43) };
    expect(await refusal(verifyIdToken(token(), next, keys))).toBe('nonce_mismatch');
  });

  it('needs auth_time within 5 minutes for a step-up', async () => {
    const keys = keysFrom(JWKS);
    const stepUp = { ...expected, maxAuthAge: 300 };
    expect(await refusal(verifyIdToken(token(), stepUp, keys))).toBe('auth_time_missing');
    expect(await refusal(verifyIdToken(token({ auth_time: NOW - 301 }), stepUp, keys))).toBe(
      'auth_time_stale',
    );
    expect(await refusal(verifyIdToken(token({ auth_time: NOW + 61 }), stepUp, keys))).toBe(
      'auth_time_stale',
    );
    await expect(
      verifyIdToken(token({ auth_time: NOW - 300 }), stepUp, keys),
    ).resolves.toBeDefined();
  });

  it('puts no part of the token in a refusal', async () => {
    const bad = token({ iss: 'https://elsewhere.example.org' });
    const error = await verifyIdToken(bad, expected, keysFrom(JWKS)).catch((e: unknown) => e);
    for (const part of bad.split('.')) expect(String(error)).not.toContain(part);
  });

  it('refuses when the provider’s keys cannot be fetched', async () => {
    const failing = new JwksCache(() => Promise.reject(new Error('refused'))).lookup('p', 'u');
    expect(await refusal(verifyIdToken(token(), expected, failing))).toBe('keys_unavailable');
  });
});
