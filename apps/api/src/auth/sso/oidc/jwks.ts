// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An OIDC provider's signing keys (ADR 0010, "SSO" and "Outbound requests").
// They come only from the provider's stored jwks_uri, fetched through the
// global outbound dispatcher, which checks every address it connects to, and
// are kept per provider for 5 minutes. A key is used only for the header's
// algorithm, one of RS256, PS256 or ES256: never one whose own `alg`, `use`,
// type or curve disagrees, nor an RSA key under 2048 bits. A `kid` the
// cached set lacks refetches it once; nothing else refetches.

import { createPublicKey, type KeyObject } from 'node:crypto';

import { z } from 'zod';

export const ALGORITHMS = ['RS256', 'PS256', 'ES256'] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

const JWKS_SECONDS = 300;
const FETCH_TIMEOUT_MS = 5_000;

/**
 * The key for the header's `kid` and algorithm, or undefined if the provider
 * has none that fits. Throws if the keys cannot be fetched.
 */
export type KeyLookup = (kid: string | undefined, alg: Algorithm) => Promise<KeyObject | undefined>;

const jwkSchema = z.object({
  kty: z.string(),
  kid: z.string().optional(),
  use: z.string().optional(),
  alg: z.string().optional(),
  n: z.string().optional(),
  e: z.string().optional(),
  crv: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
});
type Jwk = z.infer<typeof jwkSchema>;

const jwksSchema = z.object({ keys: z.array(z.unknown()).max(100) });

/** The public key `jwk` gives for `alg`, or undefined if it is not one for signing with `alg`. */
function keyFor(jwk: Jwk, alg: Algorithm): KeyObject | undefined {
  if ((jwk.use !== undefined && jwk.use !== 'sig') || (jwk.alg !== undefined && jwk.alg !== alg)) {
    return undefined;
  }
  const { kty, n, e, crv, x, y } = jwk;
  let key: KeyObject;
  try {
    if (alg === 'ES256') {
      if (kty !== 'EC' || crv !== 'P-256' || x === undefined || y === undefined) return undefined;
      key = createPublicKey({ key: { kty, crv, x, y }, format: 'jwk' });
    } else {
      if (kty !== 'RSA' || n === undefined || e === undefined) return undefined;
      key = createPublicKey({ key: { kty, n, e }, format: 'jwk' });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return undefined;
    }
  } catch {
    return undefined;
  }
  return key;
}

/** The key with `kid`, or the provider's only key for `alg` when the header names none. */
function pick(
  jwks: readonly Jwk[],
  kid: string | undefined,
  alg: Algorithm,
): KeyObject | 'unknown' | undefined {
  if (kid === undefined) {
    const keys = jwks.map((jwk) => keyFor(jwk, alg)).filter((key) => key !== undefined);
    return keys.length === 1 ? keys[0] : undefined;
  }
  const named = jwks.filter((jwk) => jwk.kid === kid);
  if (named.length === 0) return 'unknown';
  return named.length === 1 && named[0] !== undefined ? keyFor(named[0], alg) : undefined;
}

export type FetchJson = (url: string) => Promise<unknown>;

/** A GET through the global dispatcher, which checks every address and caps the body at 1 MB. */
const fetchJson: FetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The keys answered ${String(response.status)}.`);
  return response.json();
};

/** Each provider's signing keys, kept for 5 minutes. */
export class JwksCache {
  readonly #sets = new Map<string, { readonly keys: readonly Jwk[]; readonly until: number }>();
  readonly #fetch: FetchJson;
  readonly #now: () => number;

  constructor(fetch: FetchJson = fetchJson, now: () => number = Date.now) {
    this.#fetch = fetch;
    this.#now = now;
  }

  /** The lookup for provider `providerId`, whose keys are at `jwksUri`. */
  lookup(providerId: string, jwksUri: string): KeyLookup {
    const name = `${providerId}\0${jwksUri}`;
    return async (kid, alg) => {
      const cached = this.#sets.get(name);
      const fresh = cached === undefined || cached.until <= this.#now();
      const found = pick(fresh ? await this.#load(name, jwksUri) : cached.keys, kid, alg);
      if (found !== 'unknown') return found;
      if (fresh) return undefined;
      const again = pick(await this.#load(name, jwksUri), kid, alg);
      return again === 'unknown' ? undefined : again;
    };
  }

  async #load(name: string, uri: string): Promise<readonly Jwk[]> {
    let document: unknown;
    try {
      document = await this.#fetch(uri);
    } catch {
      throw new Error("The provider's keys could not be fetched.");
    }
    const parsed = jwksSchema.safeParse(document);
    if (!parsed.success) throw new Error("The provider's keys are not a key set.");
    const keys = parsed.data.keys.flatMap((entry) => {
      const jwk = jwkSchema.safeParse(entry);
      return jwk.success ? [jwk.data] : [];
    });
    this.#sets.set(name, { keys, until: this.#now() + JWKS_SECONDS * 1000 });
    return keys;
  }
}
