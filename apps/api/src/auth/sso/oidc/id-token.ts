// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Checking an OIDC ID token (ADR 0010, "SSO"; OpenID Connect Core 3.1.3.7).
// The header's algorithm must be RS256, PS256 or ES256, so `none`, HMAC and
// anything else are refused before any key is looked up, and the key comes
// from the provider's own set (jwks.ts). The issuer is compared exactly, the
// audience must hold our client id, `azp` must equal it when present or when
// there are several audiences, and `exp`, `iat`, the nonce and, for a
// step-up, `auth_time` are checked with at most 60 seconds of clock skew. A
// refusal carries only a reason code, never the token.

import { constants, verify, type KeyObject } from 'node:crypto';

import { z } from 'zod';

import { ALGORITHMS, type Algorithm, type KeyLookup } from './jwks.ts';

const SKEW_SECONDS = 60;
const MAX_TOKEN_CHARS = 16_384;

export type IdTokenRejection =
  | 'token_malformed'
  | 'algorithm_refused'
  | 'keys_unavailable'
  | 'key_unknown'
  | 'signature_invalid'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'token_expired'
  | 'issued_in_future'
  | 'nonce_mismatch'
  | 'auth_time_missing'
  | 'auth_time_stale';

export class IdTokenRefused extends Error {
  readonly reason: IdTokenRejection;

  constructor(reason: IdTokenRejection) {
    super(`The ID token was refused: ${reason}.`);
    this.reason = reason;
  }
}

const headerSchema = z.object({ alg: z.string(), kid: z.string().max(256).optional() });

const claimsSchema = z.object({
  iss: z.string(),
  sub: z.string().min(1).max(512),
  aud: z.union([z.string(), z.array(z.string()).min(1)]),
  azp: z.string().optional(),
  exp: z.number(),
  iat: z.number(),
  nonce: z.string().optional(),
  auth_time: z.number().optional(),
  email: z.string().max(320).optional(),
  email_verified: z.boolean().optional(),
  amr: z.array(z.string().max(256)).max(20).optional(),
  acr: z.string().max(256).optional(),
});

export type IdClaims = z.infer<typeof claimsSchema>;

export interface Expected {
  /** The provider's configured issuer, compared exactly. */
  readonly issuer: string;
  readonly clientId: string;
  /** The nonce the state record holds. */
  readonly nonce: string;
  /** For a step-up: how old `auth_time` may be, in seconds. */
  readonly maxAuthAge?: number;
  /** Seconds since the epoch. */
  readonly now?: number;
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;

function decodeJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

function signatureMatches(alg: Algorithm, key: KeyObject, data: Buffer, signature: Buffer) {
  if (alg === 'ES256') {
    return (
      key.asymmetricKeyType === 'ec' &&
      signature.length === 64 &&
      verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, signature)
    );
  }
  if (key.asymmetricKeyType !== 'rsa') return false;
  const padding =
    alg === 'PS256'
      ? { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }
      : { padding: constants.RSA_PKCS1_PADDING };
  return verify('sha256', data, { key, ...padding }, signature);
}

/** The token's claims, once every check above passes; otherwise throws IdTokenRefused. */
export async function verifyIdToken(
  token: string,
  expected: Expected,
  keys: KeyLookup,
): Promise<IdClaims> {
  const parts = token.split('.');
  if (
    token.length > MAX_TOKEN_CHARS ||
    parts.length !== 3 ||
    !parts.every((p) => BASE64URL.test(p))
  ) {
    throw new IdTokenRefused('token_malformed');
  }
  const [encodedHeader = '', encodedClaims = '', encodedSignature = ''] = parts;
  const header = headerSchema.safeParse(decodeJson(encodedHeader));
  if (!header.success) throw new IdTokenRefused('token_malformed');
  const alg = ALGORITHMS.find((allowed) => allowed === header.data.alg);
  if (alg === undefined) throw new IdTokenRefused('algorithm_refused');

  const key = await keys(header.data.kid, alg).catch(() => {
    throw new IdTokenRefused('keys_unavailable');
  });
  if (key === undefined) throw new IdTokenRefused('key_unknown');
  const data = Buffer.from(`${encodedHeader}.${encodedClaims}`, 'ascii');
  if (!signatureMatches(alg, key, data, Buffer.from(encodedSignature, 'base64url'))) {
    throw new IdTokenRefused('signature_invalid');
  }

  const parsed = claimsSchema.safeParse(decodeJson(encodedClaims));
  if (!parsed.success) throw new IdTokenRefused('token_malformed');
  const claims = parsed.data;
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  const audiences = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;

  if (claims.iss !== expected.issuer) throw new IdTokenRefused('issuer_mismatch');
  if (!audiences.includes(expected.clientId)) throw new IdTokenRefused('audience_mismatch');
  if ((claims.azp !== undefined || audiences.length > 1) && claims.azp !== expected.clientId) {
    throw new IdTokenRefused('audience_mismatch');
  }
  if (now > claims.exp + SKEW_SECONDS) throw new IdTokenRefused('token_expired');
  if (claims.iat > now + SKEW_SECONDS) throw new IdTokenRefused('issued_in_future');
  if (claims.nonce !== expected.nonce) throw new IdTokenRefused('nonce_mismatch');
  if (expected.maxAuthAge !== undefined) {
    if (claims.auth_time === undefined) throw new IdTokenRefused('auth_time_missing');
    const age = now - claims.auth_time;
    if (age > expected.maxAuthAge || age < -SKEW_SECONDS) {
      throw new IdTokenRefused('auth_time_stale');
    }
  }
  return claims;
}
