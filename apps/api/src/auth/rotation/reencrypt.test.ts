// SPDX-License-Identifier: AGPL-3.0-or-later
//
// rotationKeys(): the newest version seals; a TOTP value Better Auth stored
// under the single auth secret, with no version, opens with version 1's.

import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';

import { Secret } from '../../config.ts';
import { openSecret, sealSecret, ssoSecretKeys } from '../sso/secrets.ts';
import { rotationKeys } from './reencrypt.ts';

const ONE = new Secret('rotation unit test secret, version one');
const TWO = new Secret('rotation unit test secret, version two');

describe('rotationKeys', () => {
  it('seals with the newest version and opens values from version 1', async () => {
    const keys = rotationKeys(
      new Map([
        [2, TWO],
        [1, ONE],
      ]),
    );
    expect(keys.current).toBe(2);
    expect(keys.older).toEqual([1]);

    const bare = await symmetricEncrypt({ key: ONE.reveal(), data: 'totp' });
    expect(await symmetricDecrypt({ key: keys.totp, data: bare })).toBe('totp');
    expect(await symmetricEncrypt({ key: keys.totp, data: 'totp' })).toMatch(/^\$ba\$2\$/);

    // The SSO adapter's own key for the settings' one secret is version 1's here.
    const place = { column: 'client_secret', providerId: 'p', tenantId: 't' } as const;
    const { sealed } = sealSecret(ssoSecretKeys(ONE), place, 'sso');
    expect(openSecret(keys.sso, place, sealed, 1)).toBe('sso');
    expect(sealSecret(keys.sso, place, 'sso').keyVersion).toBe(2);
  });

  it('has no legacy secret without version 1', () => {
    const keys = rotationKeys(
      new Map([
        [41, ONE],
        [42, TWO],
      ]),
    );
    expect(keys.totp.legacySecret).toBeUndefined();
  });
});
