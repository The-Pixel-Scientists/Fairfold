// SPDX-License-Identifier: AGPL-3.0-or-later
//
// rotationKeys(): the current version seals; a TOTP value Better Auth stored
// under the single auth secret, with no version, opens with version 1's.

import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';

import { Secret } from '../../config.ts';
import { openSecret, sealSecret, ssoSecretKeys } from '../sso/secrets.ts';
import { rotationKeys } from './reencrypt.ts';

const ONE = new Secret('rotation unit test secret, version one');
const TWO = new Secret('rotation unit test secret, version two');
const both = (current: number) => ({
  current,
  versions: new Map([
    [2, TWO],
    [1, ONE],
  ]),
});

describe('rotationKeys', () => {
  it('seals with the current version and opens values from version 1', async () => {
    const keys = rotationKeys(both(2));
    expect(keys.current).toBe(2);
    expect(keys.older).toEqual([1]);

    const bare = await symmetricEncrypt({ key: ONE.reveal(), data: 'totp' });
    expect(await symmetricDecrypt({ key: keys.totp, data: bare })).toBe('totp');
    expect(await symmetricEncrypt({ key: keys.totp, data: 'totp' })).toMatch(/^\$ba\$2\$/);

    // A value the API sealed while version 1 was its only version.
    const place = { column: 'client_secret', providerId: 'p', tenantId: 't' } as const;
    const single = ssoSecretKeys({ current: 1, versions: new Map([[1, ONE]]) });
    const { sealed } = sealSecret(single, place, 'sso');
    expect(openSecret(keys.sso, place, sealed, 1)).toBe('sso');
    expect(sealSecret(keys.sso, place, 'sso').keyVersion).toBe(2);
  });

  it('moves everything to the named version, even an older one', () => {
    const keys = rotationKeys(both(1));
    expect(keys.current).toBe(1);
    expect(keys.older).toEqual([2]);
    expect(keys.totp.currentVersion).toBe(1);
  });

  it('has no legacy secret without version 1', () => {
    const keys = rotationKeys({
      current: 42,
      versions: new Map([
        [41, ONE],
        [42, TWO],
      ]),
    });
    expect(keys.totp.legacySecret).toBeUndefined();
  });
});
