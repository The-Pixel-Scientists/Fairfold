// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who a request counts against, and the key the counter is stored under.
//
// The address is only ever `request.ip`, which Fastify derives from the
// explicit trusted proxy list (server.ts); nothing here reads a header. An
// IPv4 address mapped into IPv6 counts as the IPv4 address, and an IPv6
// address counts as its /64 network (ADR 0010). The counter's key is an
// HMAC-SHA-256 under a server secret, so the table holds no address, user or
// session in clear (ADR 0028).

import { createHmac } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';

import type { Secret } from '../config.ts';
import { LIMITS, type LimitName } from './definitions.ts';

/** The eight 16-bit groups of a valid IPv6 address. */
function groupsOf(address: string): number[] {
  let text = address.split('%')[0] ?? '';
  const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (quad !== null) {
    const [a, b, c, d] = quad.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, quad.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const first = head === '' ? [] : head.split(':');
  const last = tail === undefined || tail === '' ? [] : tail.split(':');
  const gap = tail === undefined ? [] : Array<string>(8 - first.length - last.length).fill('0');
  return [...first, ...gap, ...last].map((group) => parseInt(group, 16));
}

/** The IPv4 address, or the first `groups` 16-bit groups of the IPv6 address, that an address counts as. */
function networkOf(ip: string, groups: 4 | 3): string {
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return 'invalid';
  const all = groupsOf(ip);
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = all;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return `${String(g6 >> 8)}.${String(g6 & 255)}.${String(g7 >> 8)}.${String(g7 & 255)}`;
  }
  return `${all
    .slice(0, groups)
    .map((group) => group.toString(16))
    .join(':')}::/${String(groups * 16)}`;
}

/** The IPv4 address, or the IPv6 /64 network, that an address counts as. */
export function clientNetwork(ip: string): string {
  return networkOf(ip, 4);
}

/**
 * The IPv4 address, or the IPv6 /48 network, that shares one budget of store
 * calls in progress, so rotating through the /64s of one allocation gains nothing.
 */
export function clientGroup(ip: string): string {
  return networkOf(ip, 3);
}

/** The 32-byte key of one limit's counter for one subject, such as a network or a user. */
export function keyHash(secret: Secret, limit: LimitName, subject: string): Buffer {
  return createHmac('sha256', secret.reveal())
    .update(`${LIMITS[limit].bucket}\0${limit}\0${subject}`)
    .digest();
}
