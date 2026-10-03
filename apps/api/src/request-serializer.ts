// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a request appears in a log line (ADR 0004, "Identity, URLs and logs"):
// its method, host and URL, and nothing else. In particular, not its headers,
// its body and the address of the caller.
//
// The URL is shown with these changes:
//
//   - A request that matched no route shows a placeholder, never its path:
//     the path may be an auth path in disguise, or carry a token.
//   - The query string is reduced to its keys, and a key is shown only if it
//     looks like a parameter name. Values are never logged.
//   - On an auth route the query string is dropped altogether, and the path is
//     replaced by the route's pattern, because reset tokens, OIDC `code` and
//     `state` and SSO completion handles travel there.

import { CENSOR } from './redaction.ts';

const MAX_URL_LENGTH = 2048;

const NO_ROUTE = '[no route]';

/**
 * The routes of Better Auth and our own sign-in routes. Their paths and
 * queries can hold single-use tokens (ADR 0004). Widen this if they move.
 */
const AUTH_ROUTE = /^\/(?:api\/)?auth(?:\/|$)/i;

/** What a parameter name looks like. A key that does not may be a token or an email address. */
const PARAMETER_NAME = /^[A-Za-z0-9_.[\]-]{1,64}$/;

/**
 * The URL as it may appear in a log. `route` is the pattern of the route the
 * request matched, such as `/auth/reset/:token`, if it matched one.
 */
export function loggableUrl(url: string, route: string | undefined): string {
  if (route === undefined) return NO_ROUTE;

  const queryStart = url.indexOf('?');
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  const query = queryStart === -1 ? '' : url.slice(queryStart + 1);

  let result: string;
  if (AUTH_ROUTE.test(route)) {
    result = query === '' ? route : `${route}?${CENSOR}`;
  } else {
    const keys = query.split('&').map((pair) => pair.split('=', 1)[0] ?? '');
    const shown = keys.map((key) => (PARAMETER_NAME.test(key) ? key : CENSOR));
    result = query === '' ? path : `${path}?${shown.join('&')}`;
  }
  return result.length > MAX_URL_LENGTH ? `${result.slice(0, MAX_URL_LENGTH)}...` : result;
}

/** What the request serialiser reads from a Fastify request. */
interface LoggedRequest {
  method?: string;
  url?: string;
  host?: string;
  routeOptions?: { url?: string };
}

export function serializeRequest(request: LoggedRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: loggableUrl(request.url ?? '', request.routeOptions?.url),
    host: request.host?.slice(0, 255),
  };
}
