// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The keyed hash of an email address that a suppression and an unsubscribe
// token carry (ADR 0033): HMAC-SHA-256 of the trimmed, lower-cased address
// under a per-tenant key, which HKDF-SHA-256 derives from the deployment's
// suppression secret and the tenant id. The same address hashes differently
// in two tenants. The secret is read by the caller and never logged; a key
// version is recorded with every hash.

import { createHmac, hkdfSync } from 'node:crypto';

import { idSchema } from '@pixel-scientists/domain';

export interface AddressHash {
  readonly hash: Buffer;
  readonly keyVersion: number;
}

/** The suppression secrets by version, and the version that hashes new rows. */
export interface SuppressionKeys {
  readonly current: number;
  readonly secrets: ReadonlyMap<number, string>;
}

export function suppressionKeys(
  secrets: ReadonlyMap<number, string>,
  current: number,
): SuppressionKeys {
  if (!secrets.has(current)) throw new Error('The current suppression key version has no secret.');
  for (const [version, secret] of secrets) {
    if (!Number.isInteger(version) || version < 1 || version > 255) {
      throw new Error('A suppression key version must be a whole number from 1 to 255.');
    }
    if (secret.length < 32) throw new Error('A suppression key secret is too short.');
  }
  return { current, secrets };
}

/** The address's hash for a tenant under the current key version; throws if the tenant id is not valid. */
export function addressHash(keys: SuppressionKeys, tenantId: string, address: string): AddressHash {
  const secret = keys.secrets.get(keys.current);
  if (secret === undefined || !idSchema.safeParse(tenantId).success) {
    throw new Error('An address hash needs a valid tenant and key.');
  }
  const key = Buffer.from(hkdfSync('sha256', secret, '', `tps-suppression:${tenantId}`, 32));
  const hash = createHmac('sha256', key).update(address.trim().toLowerCase(), 'utf8').digest();
  return { hash, keyVersion: keys.current };
}
