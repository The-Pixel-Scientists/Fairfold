// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Secret } from '../../config.ts';
import { openSecret, sealSecret, ssoSecretKeys, type SecretPlace } from './secrets.ts';

const keys = ssoSecretKeys(new Secret('a test secret of at least thirty-two bytes'));
const place: SecretPlace = {
  column: 'client_secret',
  providerId: randomUUID(),
  tenantId: randomUUID(),
};
const VALUE = 'client-secret-value-0123456789';

describe('SSO secrets', () => {
  it('opens a value sealed for the same place, and never holds it in clear', () => {
    const { sealed, keyVersion } = sealSecret(keys, place, VALUE);
    expect(keyVersion).toBe(1);
    expect(sealed.includes(Buffer.from(VALUE))).toBe(false);
    expect(sealed.length).toBe(12 + Buffer.byteLength(VALUE) + 16);
    expect(openSecret(keys, place, sealed, keyVersion)).toBe(VALUE);
  });

  it('uses a new nonce each time', () => {
    expect(
      sealSecret(keys, place, VALUE).sealed.equals(sealSecret(keys, place, VALUE).sealed),
    ).toBe(false);
  });

  it.each([
    ['another row', { providerId: randomUUID() }],
    ['another column', { column: 'sp_private_key' as const }],
    ['another tenant', { tenantId: randomUUID() }],
  ])('refuses a value copied to %s', (_, moved) => {
    const { sealed } = sealSecret(keys, place, VALUE);
    expect(() => openSecret(keys, { ...place, ...moved }, sealed, 1)).toThrow();
  });

  it('refuses a changed value, a value too short, and an unknown key version', () => {
    const { sealed } = sealSecret(keys, place, VALUE);
    const changed = Buffer.from(sealed);
    changed[14] = (changed[14] ?? 0) ^ 1;
    expect(() => openSecret(keys, place, changed, 1)).toThrow();
    expect(() => openSecret(keys, place, sealed.subarray(0, 28), 1)).toThrow();
    expect(() => openSecret(keys, place, sealed, 2)).toThrow('No SSO secret key has version 2.');
  });

  it('derives a key of its own from the auth secret', () => {
    const other = ssoSecretKeys(new Secret('another test secret of at least thirty-two bytes'));
    const { sealed } = sealSecret(keys, place, VALUE);
    expect(() => openSecret(other, place, sealed, 1)).toThrow();
  });
});
