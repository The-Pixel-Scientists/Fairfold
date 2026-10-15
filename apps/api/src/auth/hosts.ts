// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which app a request is for (ADR 0010, "Hosts"): from the host Fastify
// derives through the trusted proxy list, compared with the configured
// origins' hosts after normalising case, a trailing dot and IDNA, and
// ignoring the port, since cookies do not separate ports. On a single host
// the console is told apart by its fixed path prefix. Never from a request
// parameter.

import type { App } from '@pixel-scientists/domain/platform';

import type { AuthSettings } from './settings.ts';

/** Characters the URL parser would read as more than a host. */
const NOT_A_HOST = /[@/\\?#%]/;

/** Spaces and control characters, which the URL parser drops or refuses. */
function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** A host as compared: lower case, IDNA as punycode, no trailing dot, no port. Null if it is not one. */
export function normaliseHost(host: string | undefined): string | null {
  if (host === undefined || host === '' || NOT_A_HOST.test(host) || hasControlOrSpace(host)) {
    return null;
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
  const name = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  return name === '' ? null : name;
}

/** Whether `url` is the prefix itself or a path under it. */
function underPrefix(url: string, prefix: string): boolean {
  return url === prefix || (url.startsWith(prefix) && /^[/?#]/.test(url.slice(prefix.length)));
}

/**
 * Resolves a request's host and original URL (before any rewrite) to its
 * app, or null for a host that is not configured.
 */
export function appResolver(
  settings: AuthSettings,
): (host: string, originalUrl: string) => App | null {
  const consoleHost = normaliseHost(new URL(settings.origins.console).host);
  const portalHost = normaliseHost(new URL(settings.origins.portal).host);
  const prefix = settings.consolePathPrefix;
  return (host, originalUrl) => {
    const name = normaliseHost(host);
    if (name === null) return null;
    if (prefix !== undefined) {
      if (name !== consoleHost) return null;
      return underPrefix(originalUrl, prefix) ? 'console' : 'portal';
    }
    if (name === consoleHost) return 'console';
    if (name === portalHost) return 'portal';
    return null;
  };
}

/**
 * On a single host, the rewrite the server applies before routing: the
 * console's prefix is removed, so its requests reach the same routes. The
 * app is still resolved from the original URL. Undefined with two hosts.
 */
export function singleHostRewrite(
  settings: AuthSettings,
): ((request: { url?: string }) => string) | undefined {
  const prefix = settings.consolePathPrefix;
  if (prefix === undefined) return undefined;
  return ({ url = '/' }) => {
    if (!underPrefix(url, prefix)) return url;
    const rest = url.slice(prefix.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  };
}
