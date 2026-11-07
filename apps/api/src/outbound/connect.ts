// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The connect path (ADR 0010): resolve the host once, check every address it
// resolves to, and give back the address that was checked. The caller
// connects to that address and to no other, so a second lookup cannot return
// something else between the check and the connection (DNS rebinding).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { OutboundError } from './errors.ts';
import { isGloballyReachable } from './ranges.ts';

/** Every address a host name resolves to. An IP literal resolves to itself. */
export type Resolve = (host: string) => Promise<readonly string[]>;

/** The system resolver, IPv4 first, since a host may have no IPv6 route. */
export const systemResolve: Resolve = async (host) =>
  (await lookup(host, { all: true, order: 'ipv4first' })).map((entry) => entry.address);

/** A host name or IP literal without the brackets of an IPv6 literal. */
export const bareHost = (host: string): string => host.replace(/^\[|\]$/g, '');

/** The server name for TLS: the host name, which an IP literal has none of. */
export const serverName = (host: string): string | undefined =>
  isIP(bareHost(host)) === 0 ? bareHost(host) : undefined;

/** The address to connect to. Refuses unless every resolved address is public. */
export async function checkedAddress(host: string, resolve: Resolve): Promise<string> {
  let addresses: readonly string[];
  try {
    addresses = await resolve(bareHost(host));
  } catch {
    throw new OutboundError('unresolvable');
  }
  const [first] = addresses;
  if (first === undefined || !addresses.every(isGloballyReachable)) {
    throw new OutboundError('address_refused');
  }
  return first;
}
