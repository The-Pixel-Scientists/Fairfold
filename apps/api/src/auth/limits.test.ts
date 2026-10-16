// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { Secret } from '../config.ts';
import { identifierKeeper, plainAddress } from './limits.ts';

describe('plainAddress', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8::1', '2001:db8::1'],
    ['fe80::1%eth0', 'fe80::1'],
  ])('counts %s as %s', (ip, expected) => {
    expect(plainAddress(ip)).toBe(expected);
  });
});

describe('identifierKeeper', () => {
  const keep = identifierKeeper(new Secret('a synthetic auth secret of 32 bytes or more'));

  it('keeps a valid address normalised', () => {
    expect(keep('  Someone@Example.TEST ')).toBe('someone@example.test');
  });

  it('keeps anything else only as an HMAC under its own key', () => {
    const kept = keep('my-password-typed-by-mistake');
    expect(kept).toMatch(/^[0-9a-f]{64}$/);
    expect(keep('my-password-typed-by-mistake')).toBe(kept);
    const other = identifierKeeper(new Secret('another synthetic secret of 32 bytes'));
    expect(other('my-password-typed-by-mistake')).not.toBe(kept);
  });
});
