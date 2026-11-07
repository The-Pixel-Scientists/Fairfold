// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SSO secrets at rest (ADR 0010, "Secrets at rest"): an OIDC client secret
// or a SAML signing key is kept only as AES-256-GCM ciphertext, under a key
// HKDF-SHA-256 derives from the auth secret for this purpose alone. Each
// value has a random 96-bit nonce, and its table, column, row id and tenant
// id as associated data, so a value copied to another row, column or tenant
// fails to open. The row records the key version beside it (migration
// 0027). A sealed value is the nonce, the ciphertext and the 16-byte tag.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import type { Secret } from '../../config.ts';
import type { AuthSecrets } from '../settings.ts';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** The SSO secret keys by version, and the version that seals new values. */
export interface SsoSecretKeys {
  readonly current: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

/** A key for each version of the auth secret. */
export function ssoSecretKeys({ current, versions }: AuthSecrets): SsoSecretKeys {
  const derive = (secret: Secret) =>
    Buffer.from(hkdfSync('sha256', secret.reveal(), '', 'tps-auth-sso-secret', 32));
  const keys = new Map([...versions].map(([version, secret]) => [version, derive(secret)]));
  return { current, keys };
}

/** Where a sealed value lives, which it is bound to. */
export interface SecretPlace {
  readonly column: 'client_secret' | 'sp_private_key';
  readonly providerId: string;
  readonly tenantId: string;
}

const associatedData = ({ column, providerId, tenantId }: SecretPlace): Buffer =>
  Buffer.from(['auth.sso_provider', column, providerId, tenantId].join('\0'), 'utf8');

function keyOf(keys: SsoSecretKeys, version: number): Buffer {
  const key = keys.keys.get(version);
  if (key === undefined) throw new Error(`No SSO secret key has version ${String(version)}.`);
  return key;
}

/** Seal `value` for `place` under the current key. */
export function sealSecret(
  keys: SsoSecretKeys,
  place: SecretPlace,
  value: string,
): { readonly sealed: Buffer; readonly keyVersion: number } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyOf(keys, keys.current), nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(associatedData(place));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { sealed: Buffer.concat([nonce, body, cipher.getAuthTag()]), keyVersion: keys.current };
}

/** Open a value sealed for `place` under the key of `keyVersion`. Throws if it was sealed for anywhere else. */
export function openSecret(
  keys: SsoSecretKeys,
  place: SecretPlace,
  sealed: Buffer,
  keyVersion: number,
): string {
  if (sealed.length <= NONCE_BYTES + TAG_BYTES)
    throw new Error('A sealed SSO secret is too short.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyOf(keys, keyVersion),
    sealed.subarray(0, NONCE_BYTES),
    { authTagLength: TAG_BYTES },
  );
  decipher.setAAD(associatedData(place));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  const body = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
