// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { EMBEDDING_V6, REFUSED_V4, REFUSED_V6, isGloballyReachable } from './ranges.ts';

type Edges = [first: string, last: string, below?: string, above?: string];

/** Each refused range: its first and last address, and a public address just outside each end. */
const V4_EDGES: Record<string, Edges> = {
  '0.0.0.0/8': ['0.0.0.0', '0.255.255.255', undefined, '1.0.0.0'],
  '10.0.0.0/8': ['10.0.0.0', '10.255.255.255', '9.255.255.255', '11.0.0.0'],
  '100.64.0.0/10': ['100.64.0.0', '100.127.255.255', '100.63.255.255', '100.128.0.0'],
  '127.0.0.0/8': ['127.0.0.0', '127.255.255.255', '126.255.255.255', '128.0.0.0'],
  '169.254.0.0/16': ['169.254.0.0', '169.254.255.255', '169.253.255.255', '169.255.0.0'],
  '172.16.0.0/12': ['172.16.0.0', '172.31.255.255', '172.15.255.255', '172.32.0.0'],
  '192.0.0.0/24': ['192.0.0.0', '192.0.0.255', '191.255.255.255', '192.0.1.0'],
  '192.0.2.0/24': ['192.0.2.0', '192.0.2.255', '192.0.1.255', '192.0.3.0'],
  '192.88.99.0/24': ['192.88.99.0', '192.88.99.255', '192.88.98.255', '192.88.100.0'],
  '192.168.0.0/16': ['192.168.0.0', '192.168.255.255', '192.167.255.255', '192.169.0.0'],
  '198.18.0.0/15': ['198.18.0.0', '198.19.255.255', '198.17.255.255', '198.20.0.0'],
  '198.51.100.0/24': ['198.51.100.0', '198.51.100.255', '198.51.99.255', '198.51.101.0'],
  '203.0.113.0/24': ['203.0.113.0', '203.0.113.255', '203.0.112.255', '203.0.114.0'],
  '224.0.0.0/4': ['224.0.0.0', '239.255.255.255', '223.255.255.255', undefined],
  '240.0.0.0/4': ['240.0.0.0', '255.255.255.255', undefined, undefined],
};

const V6_EDGES: Record<string, Edges> = {
  '2001::/23': [
    '2001:1::',
    '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:200::',
  ],
  '2001:db8::/32': [
    '2001:db8::',
    '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:db9::',
  ],
  '3fff::/20': [
    '3fff::',
    '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff',
    '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '3fff:1000::',
  ],
};

function expectEdges([first, last, below, above]: Edges): void {
  expect(isGloballyReachable(first)).toBe(false);
  expect(isGloballyReachable(last)).toBe(false);
  if (below !== undefined) expect(isGloballyReachable(below)).toBe(true);
  if (above !== undefined) expect(isGloballyReachable(above)).toBe(true);
}

describe('the address policy: IPv4', () => {
  it('has an edge test for every refused range', () => {
    expect(Object.keys(V4_EDGES).sort()).toEqual([...REFUSED_V4].sort());
  });

  it.each(Object.entries(V4_EDGES))('refuses %s at both edges', (_cidr, edges) => {
    expectEdges(edges);
  });

  it('refuses the metadata address and the limited broadcast address', () => {
    expect(isGloballyReachable('169.254.169.254')).toBe(false);
    expect(isGloballyReachable('255.255.255.255')).toBe(false);
  });

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '192.88.98.1', '223.255.255.254'])(
    'allows the public address %s',
    (address) => {
      expect(isGloballyReachable(address)).toBe(true);
    },
  );
});

describe('the address policy: IPv6', () => {
  it('has an edge test for every refused range inside 2000::/3', () => {
    expect(Object.keys(V6_EDGES).sort()).toEqual([...REFUSED_V6].sort());
  });

  it.each(Object.entries(V6_EDGES))('refuses %s at both edges', (_cidr, edges) => {
    expectEdges(edges);
  });

  it.each([
    ['::', 'the unspecified address'],
    ['::1', 'loopback'],
    ['::2', 'the next address after loopback'],
    ['100::', 'the start of the discard prefix'],
    ['100::ffff:ffff:ffff:ffff', 'the end of the discard prefix'],
    ['fc00::', 'the start of unique local'],
    ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'the end of unique local'],
    ['fd00:ec2::254', 'the AWS metadata address'],
    ['fe80::', 'the start of link local'],
    ['febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'the end of link local'],
    ['fe80::1%eth0', 'link local with a zone id'],
    ['ff00::', 'the start of multicast'],
    ['ff02::1', 'all nodes'],
    ['5f00::', 'segment routing'],
    ['64:ff9b:1::', 'the start of local-use NAT64'],
    ['64:ff9b:1:ffff:ffff:ffff:ffff:ffff', 'the end of local-use NAT64'],
    ['64:ff9b:1::808:808', 'local-use NAT64 around a public IPv4 address'],
    ['::808:808', 'an IPv4-compatible address'],
    ['4000::', 'space outside 2000::/3'],
  ])('refuses %s (%s)', (address) => {
    expect(isGloballyReachable(address)).toBe(false);
  });

  it.each([
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '2a00:1450:4009:81f::200e',
    '2620:4f:8000::1',
  ])('allows the public address %s', (address) => {
    expect(isGloballyReachable(address)).toBe(true);
  });

  it('refuses text that is not an address', () => {
    for (const text of [
      '',
      'example.org',
      '1.2.3',
      '1.2.3.4.5',
      '256.1.1.1',
      '0177.0.0.1',
      '::g',
    ]) {
      expect(isGloballyReachable(text)).toBe(false);
    }
    expect(isGloballyReachable('[2606:4700:4700::1111]')).toBe(true);
  });
});

describe('the address policy: IPv4 inside IPv6', () => {
  it('has a test for every embedding range', () => {
    expect(EMBEDDING_V6.map((entry) => entry.cidr)).toEqual([
      '::ffff:0:0/96',
      '64:ff9b::/96',
      '2002::/16',
      '2001::/32',
    ]);
  });

  it.each([
    ['::ffff:127.0.0.1', '::ffff:8.8.8.8'],
    ['::ffff:7f00:1', '::ffff:808:808'],
    ['::ffff:169.254.169.254', '::ffff:93.184.216.34'],
    ['::ffff:0.0.0.0', '::ffff:1.1.1.1'],
    ['::ffff:10.0.0.1', '::ffff:1.0.0.1'],
  ])('decodes IPv4-mapped %s and allows %s', (refused, allowed) => {
    expect(isGloballyReachable(refused)).toBe(false);
    expect(isGloballyReachable(allowed)).toBe(true);
  });

  it.each([
    ['64:ff9b::7f00:1', '64:ff9b::808:808'],
    ['64:ff9b::a9fe:a9fe', '64:ff9b::5db8:d822'],
    ['64:ff9b::a00:1', '64:ff9b::101:101'],
    ['64:ff9b::c0a8:1', '64:ff9b::808:404'],
  ])('decodes NAT64 %s and allows %s', (refused, allowed) => {
    expect(isGloballyReachable(refused)).toBe(false);
    expect(isGloballyReachable(allowed)).toBe(true);
  });

  it.each([
    ['2002:7f00:1::', '2002:808:808::'],
    ['2002:a9fe:a9fe::1', '2002:5db8:d822::1'],
    ['2002:a00:1::', '2002:101:101::'],
    ['2002:c0a8:1:ffff:ffff:ffff:ffff:ffff', '2002:808:404:ffff:ffff:ffff:ffff:ffff'],
  ])('decodes 6to4 %s and allows %s', (refused, allowed) => {
    expect(isGloballyReachable(refused)).toBe(false);
    expect(isGloballyReachable(allowed)).toBe(true);
  });

  // 2001:0:SSSS:SSSS:flags:port:CCCC:CCCC, with the client's port and address inverted.
  it.each([
    ['a loopback server', '2001:0:7f00:1::f7f7:fbfb'],
    ['a metadata server', '2001:0:a9fe:a9fe::f7f7:fbfb'],
    ['a loopback client', '2001:0:808:808::80ff:fffe'],
    ['a private client', '2001:0:808:808::f5ff:fffe'],
  ])('decodes Teredo with %s: %s', (_what, address) => {
    expect(isGloballyReachable(address)).toBe(false);
  });

  it('allows Teredo with a public server (8.8.8.8) and client (8.8.4.4), and no other 2001::/23 address', () => {
    expect(isGloballyReachable('2001:0:808:808::f7f7:fbfb')).toBe(true);
    expect(isGloballyReachable('2001:1::1')).toBe(false);
    expect(isGloballyReachable('2001:2::1')).toBe(false);
  });
});
