// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The only ways to reach a fixed destination (ADR 0010): SMTP, S3, clamd and
// the Have I Been Pwned API. Each client is pinned to one configured host and
// port and refuses any other, uses no proxy, verifies the certificate and has
// time limits. The configured host is the allowlist, so a pinned client may
// reach a private address that the global dispatcher refuses. Callers read
// the host and port from their settings (ADR 0005); nothing here is
// configurable except through them.

import { Agent, buildConnector, fetch as undiciFetch, type Dispatcher } from 'undici';

import { bareHost } from './connect.ts';
import { OutboundError } from './errors.ts';
import { LIMITS } from './limits.ts';

export interface Destination {
  readonly host: string;
  readonly port: number;
}

/** Fixed in code, not configurable: the breached-password check (S11-77). */
export const HIBP: Destination = Object.freeze({ host: 'api.pwnedpasswords.com', port: 443 });

/**
 * A dispatcher that connects to one host and port and to nothing else, over
 * the scheme given. The scheme is HTTPS unless the operator configured a plain
 * HTTP endpoint on a private network (the Compose stack's object store).
 */
function pinnedDispatcher({ host, port }: Destination, protocol: 'http:' | 'https:'): Dispatcher {
  const same = (a: string, b: string): boolean =>
    bareHost(a).toLowerCase() === bareHost(b).toLowerCase();
  const connector = buildConnector({
    timeout: LIMITS.connectMs,
    allowH2: false,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  });
  const connect: buildConnector.connector = (target, callback) => {
    if (
      target.protocol !== protocol ||
      !same(target.hostname, host) ||
      Number(target.port || (protocol === 'https:' ? 443 : 80)) !== port
    ) {
      callback(new OutboundError('destination_refused'), null);
      return;
    }
    connector(target, callback);
  };
  return new Agent({ connect, headersTimeout: LIMITS.headersMs, bodyTimeout: LIMITS.totalMs });
}

/** An HTTPS dispatcher that connects to the destination and to nothing else. */
export function pinnedHttpsDispatcher(destination: Destination): Dispatcher {
  return pinnedDispatcher(destination, 'https:');
}

/**
 * `fetch` for a configured endpoint (the object store): the endpoint's scheme,
 * host and port, and nothing else. The global dispatcher refuses plain HTTP and
 * private addresses, so a fixed destination goes through its own.
 */
export function pinnedFetch(endpoint: URL): typeof fetch {
  const protocol = endpoint.protocol === 'http:' ? 'http:' : 'https:';
  const dispatcher = pinnedDispatcher(
    { host: endpoint.hostname, port: Number(endpoint.port || (protocol === 'https:' ? 443 : 80)) },
    protocol,
  );
  // The package's own fetch, so the dispatcher works whichever undici Node.js bundles.
  return (input, init) => undiciFetch(input, { ...init, dispatcher });
}

/**
 * Socket options for a TCP client of the destination (`net.connect`,
 * `tls.connect`, nodemailer): the host and port, certificate checking on and
 * an idle limit. The object is frozen, so nothing can change them.
 */
export function pinnedSocketOptions(destination: Destination) {
  return Object.freeze({
    host: destination.host,
    port: destination.port,
    servername: destination.host,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    timeout: LIMITS.totalMs,
  } as const);
}
