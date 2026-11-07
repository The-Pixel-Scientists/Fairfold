// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { Secret } from '../config.ts';
import { clientGroup, clientNetwork, keyHash } from './client-key.ts';

describe('clientNetwork', () => {
  it.each([
    ['192.0.2.7', '192.0.2.7'],
    ['::ffff:192.0.2.7', '192.0.2.7'],
    ['::ffff:c000:207', '192.0.2.7'],
    ['0:0:0:0:0:ffff:c000:207', '192.0.2.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['not an address', 'invalid'],
  ])('counts %s as %s', (ip, network) => {
    expect(clientNetwork(ip)).toBe(network);
  });

  it('gives two addresses in one IPv6 /64 the same network, and another /64 a different one', () => {
    expect(clientNetwork('2001:db8:1:2::1')).toBe(clientNetwork('2001:db8:1:2:ffff::9'));
    expect(clientNetwork('2001:db8:1:2::1')).not.toBe(clientNetwork('2001:db8:1:3::1'));
  });
});

describe('clientGroup', () => {
  it('groups every /64 of one IPv6 /48, keeps IPv4 as it is, and separates other /48s', () => {
    expect(clientGroup('2001:db8:1:2::1')).toBe('2001:db8:1::/48');
    expect(clientGroup('2001:db8:1:ffff::9')).toBe('2001:db8:1::/48');
    expect(clientGroup('2001:db8:2:2::1')).not.toBe(clientGroup('2001:db8:1:2::1'));
    expect(clientGroup('::ffff:192.0.2.7')).toBe('192.0.2.7');
  });
});

describe('keyHash', () => {
  const secret = new Secret('a-key-of-at-least-thirty-two-bytes!');

  it('is 32 bytes, and holds no part of its subject', () => {
    const hash = keyHash(secret, 'general_ip', '192.0.2.7');
    expect(hash).toHaveLength(32);
    expect(hash.includes(Buffer.from('192.0.2.7'))).toBe(false);
  });

  it('differs by limit, by subject and by secret, and repeats for the same inputs', () => {
    const base = keyHash(secret, 'probe', '192.0.2.7');
    expect(keyHash(secret, 'probe', '192.0.2.7').equals(base)).toBe(true);
    expect(keyHash(secret, 'openapi', '192.0.2.7').equals(base)).toBe(false);
    expect(keyHash(secret, 'probe', '192.0.2.8').equals(base)).toBe(false);
    expect(
      keyHash(new Secret('another-key-of-at-least-32-bytes!!'), 'probe', '192.0.2.7'),
    ).not.toEqual(base);
  });
});
