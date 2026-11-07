// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The address policy (ADR 0010): which addresses an outbound request may
// reach. Only globally reachable unicast addresses pass.
//
// The tables below are the IANA IPv4 and IPv6 Special-Purpose Address
// Registries (iana.org/assignments/iana-ipv4-special-registry and
// iana-ipv6-special-registry), transcribed on 27 October 2026 without a
// network connection: compare them with the live registries when reviewing.
// Where a registry entry is globally reachable only as an anycast service
// inside a refused block (192.0.0.9, 192.0.0.10, 2001:1::1 and so on), the
// whole block is refused. Multicast, which the registries leave to their
// address-space pages, is refused too.

import { isIPv4, isIPv6 } from 'node:net';

interface Parsed {
  readonly bits: 32 | 128;
  readonly value: bigint;
}

interface Range extends Parsed {
  readonly cidr: string;
  readonly prefix: number;
}

/** Refused IPv4 ranges. */
export const REFUSED_V4 = [
  '0.0.0.0/8', // "This network"
  '10.0.0.0/8', // private use
  '100.64.0.0/10', // shared address space (carrier-grade NAT)
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link local, including 169.254.169.254 (cloud metadata)
  '172.16.0.0/12', // private use
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // documentation (TEST-NET-1)
  '192.88.99.0/24', // deprecated 6to4 relay anycast
  '192.168.0.0/16', // private use
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // documentation (TEST-NET-2)
  '203.0.113.0/24', // documentation (TEST-NET-3)
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved, including 255.255.255.255 (limited broadcast)
] as const;

/**
 * Refused IPv6 ranges inside 2000::/3, the only block allocated as global
 * unicast. Everything outside 2000::/3 is refused as well, which covers :: and
 * ::1, 100::/64 (discard), fc00::/7 (unique local, including fd00:ec2::254),
 * fe80::/10 (link local), ff00::/8 (multicast), 5f00::/16 and 64:ff9b:1::/48
 * (local-use translation); NAT64's 64:ff9b::/96 is decoded below.
 */
export const REFUSED_V6 = [
  '2001::/23', // IETF protocol assignments (Teredo is decoded below)
  '2001:db8::/32', // documentation
  '3fff::/20', // documentation
] as const;

const GLOBAL_UNICAST_V6 = '2000::/3';

/** Ranges that carry an IPv4 address: it must pass too. */
export const EMBEDDING_V6 = [
  // IPv4-mapped, NAT64 well-known prefix: the IPv4 address is the last 32 bits.
  { cidr: '::ffff:0:0/96', embedded: (value: bigint) => [value & 0xffffffffn] },
  { cidr: '64:ff9b::/96', embedded: (value: bigint) => [value & 0xffffffffn] },
  // 6to4: bits 16 to 47.
  { cidr: '2002::/16', embedded: (value: bigint) => [(value >> 80n) & 0xffffffffn] },
  // Teredo: the server (bits 32 to 63) and the client (the last 32 bits, inverted).
  {
    cidr: '2001::/32',
    embedded: (value: bigint) => [(value >> 64n) & 0xffffffffn, ~value & 0xffffffffn],
  },
] as const;

/** Turn an IP address into a number. Anything else, a zone id aside, gives undefined. */
function parse(address: string): Parsed | undefined {
  const bare = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (isIPv4(bare)) {
    return { bits: 32, value: BigInt(bare.split('.').reduce((n, octet) => n * 256 + +octet, 0)) };
  }
  if (!isIPv6(bare)) return undefined;
  // The URL parser writes the address in its short hexadecimal form.
  const canonical = new URL(`http://[${bare}]`).hostname.slice(1, -1);
  const [head = '', tail] = canonical.split('::');
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const zeros = Array<string>(8 - left.length - right.length).fill('0');
  const value = [...left, ...zeros, ...right].reduce(
    (n, group) => n * 65536n + BigInt(`0x${group}`),
    0n,
  );
  return { bits: 128, value };
}

function range(cidr: string): Range {
  const [address = '', prefix = ''] = cidr.split('/');
  const parsed = parse(address);
  if (parsed === undefined) throw new Error('A range in the address policy is not valid.');
  return { ...parsed, cidr, prefix: Number(prefix) };
}

function contains(range: Range, address: Parsed): boolean {
  if (range.bits !== address.bits) return false;
  const shift = BigInt(range.bits - range.prefix);
  return range.value >> shift === address.value >> shift;
}

const V4 = REFUSED_V4.map(range);
const V6 = REFUSED_V6.map(range);
const UNICAST = range(GLOBAL_UNICAST_V6);
const EMBEDDING = EMBEDDING_V6.map((entry) => ({ ...range(entry.cidr), embedded: entry.embedded }));

const reachableV4 = (value: bigint): boolean =>
  !V4.some((refused) => contains(refused, { bits: 32, value }));

/** Whether `address` (a resolved address or an IP literal) is globally reachable unicast. */
export function isGloballyReachable(address: string): boolean {
  const ip = parse(address);
  if (ip === undefined) return false;
  if (ip.bits === 32) return reachableV4(ip.value);
  const wrapper = EMBEDDING.find((entry) => contains(entry, ip));
  if (wrapper !== undefined) return wrapper.embedded(ip.value).every(reachableV4);
  return contains(UNICAST, ip) && !V6.some((refused) => contains(refused, ip));
}
