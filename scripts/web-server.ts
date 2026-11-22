// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Serves a built console or portal: the files Vite wrote, and index.html for
// any other path without a file extension, so the app's router can answer.
// The release images run it, and so do Playwright's production projects, so
// the tests see what ships.
//
//   node scripts/web-server.ts --root <built app> --port <port> [--host <address>]
//                              [--api <API origin>] [--embed <embed origin>]
//
// Every response carries ADR 0006's Content Security Policy and security
// headers. index.html gets a fresh nonce on each response: the nonce goes in
// the policy's style-src and replaces NONCE_PLACEHOLDER, which Vite's
// html.cspNonce option writes into the page, so a library that injects a
// <style> element can give it the nonce. Scripts never get one.
//
// Files are read once, at start-up, and served from memory, so no request
// reaches the file system. Only Node.js built-ins are used, so a release
// image needs just this file and the build.
//
// With --api, requests under /api/ go to the API unchanged, so the app
// reaches it on its own origin (ADRs 0005 and 0022). The Host header is kept,
// so the API can tell the console from the portal; any X-Forwarded-* or
// Forwarded header the client sent is dropped, and the server sets its own.
// The API's probes and OpenAPI document are not under /api/ and are never
// forwarded.
//
// With --embed, it is the embed host's server instead (ADR 0035): the
// portal build's embed.html at any path under a tenant's slug, such as
// /northfield/forms/{form id}, under the embed policy. Its frame-ancestors
// lists the origins the API's public route gives for that slug, read from
// --api and kept for a minute, and is 'none' whenever they cannot be had.
// Each lookup carries the X-Forwarded-For the proxy set, so the API counts
// it against the client that caused it. It forwards nothing, since the
// proxy sends the embed's API routes straight to the API, and it never sets
// a cookie.

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';

/** The value of html.cspNonce in each app's vite.config.ts. */
export const NONCE_PLACEHOLDER = 'TPS_CSP_NONCE';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // Browsers ignore it over plain HTTP, and keep it once a proxy adds TLS.
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Where the API's contract routes live (`apiBasePath` in packages/domain). */
const API_PATH = '/api';

/** How long the API may take to answer before the request is dropped. */
const API_TIMEOUT_MS = 60_000;

/** Headers that belong to one connection, never passed on (RFC 9110, section 7.6.1). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const styleSource = (nonce?: string): string =>
  nonce === undefined ? "style-src 'self'" : `style-src 'self' 'nonce-${nonce}'`;

/** ADR 0006's policy. Only index.html has a nonce. */
export function contentSecurityPolicy(nonce?: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    styleSource(nonce),
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

interface BuiltFile {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

/** Every file under `root`, keyed by its URL path. */
function readBuild(root: string): Map<string, BuiltFile> {
  const files = new Map<string, BuiltFile>();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const urlPath = `/${relative(root, path).split(sep).join('/')}`;
    files.set(urlPath, {
      body: readFileSync(path),
      contentType: CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
      // Vite names every file in assets/ after a hash of its content.
      cacheControl: urlPath.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
  }
  return files;
}

function send(
  response: ServerResponse,
  status: number,
  body: Buffer | string,
  headers: Readonly<Record<string, string>>,
): void {
  response.writeHead(status, { ...headers, 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
}

function sendText(
  response: ServerResponse,
  status: number,
  text: string,
  policy = contentSecurityPolicy(),
): void {
  send(response, status, `${text}\n`, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': policy,
  });
}

/** The decoded path of a request, or undefined if it cannot be decoded. */
function requestPath(url = '/'): string | undefined {
  try {
    return decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return undefined;
  }
}

/**
 * Whether a request is for the API: its path, both as sent and with dot
 * segments resolved, is /api or under /api/.
 */
export function isApiRequest(url = '/'): boolean {
  const under = (path: string): boolean => path === API_PATH || path.startsWith(`${API_PATH}/`);
  let resolved: string;
  try {
    resolved = new URL(url, 'http://localhost').pathname;
  } catch {
    return false;
  }
  return under(url.split('?', 1)[0] ?? '') && under(resolved);
}

/** The headers to pass on: none that belong to the connection, and none `drop` picks. */
function endToEnd(
  headers: IncomingHttpHeaders,
  drop: (name: string) => boolean = () => false,
): OutgoingHttpHeaders {
  const named = new Set(
    (headers.connection ?? '').split(',').map((name) => name.trim().toLowerCase()),
  );
  const kept: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name) && !named.has(name) && !drop(name)) {
      kept[name] = value;
    }
  }
  return kept;
}

/** The request's headers for the API, with this server's own forwarding headers. */
function forwardedHeaders(request: IncomingMessage): OutgoingHttpHeaders {
  const { host } = request.headers;
  return {
    ...endToEnd(request.headers, (name) => name.startsWith('x-forwarded-') || name === 'forwarded'),
    'x-forwarded-for': request.socket.remoteAddress ?? '',
    ...(host === undefined ? {} : { 'x-forwarded-host': host }),
    'x-forwarded-proto': 'http',
  };
}

/** Pass a request to the API as it came, and its answer back. */
function forward(request: IncomingMessage, response: ServerResponse, api: URL): void {
  const upstream = httpRequest(
    {
      host: api.hostname,
      port: api.port,
      method: request.method,
      path: request.url,
      headers: forwardedHeaders(request),
      timeout: API_TIMEOUT_MS,
    },
    // The API's own headers replace the server's security headers of the same name.
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, endToEnd(answer.headers));
      answer.pipe(response);
    },
  );
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => {
    if (response.headersSent) response.destroy();
    else sendText(response, 502, 'The API did not answer. Try again in a moment.');
  });
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
}

/** The API origin given with --api: plain HTTP to a host and port, with nothing else. */
export function apiOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.origin + '/' !== url.href) {
    throw new Error(`--api must be an origin such as http://api:3000, not ${value}.`);
  }
  return url;
}

/**
 * A server for the built app in `root`, which forwards /api/ to `api` if
 * given. Throws if the build has no index.html.
 */
export function createWebServer(root: string, api?: URL): Server {
  const files = readBuild(root);
  const index = files.get('/index.html');
  if (!index) throw new Error(`${root} has no index.html. Build the app first.`);
  const page = index.body.toString('utf8');

  return createServer((request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    if (api !== undefined && isApiRequest(request.url)) {
      forward(request, response, api);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Use GET or HEAD.');
      return;
    }
    const path = requestPath(request.url);
    if (path === undefined) {
      sendText(response, 400, 'The address is not valid.');
      return;
    }

    const file = files.get(path);
    if (file && path !== '/index.html') {
      send(response, 200, file.body, {
        'Content-Type': file.contentType,
        'Cache-Control': file.cacheControl,
        'Content-Security-Policy': contentSecurityPolicy(),
      });
    } else if (file || extname(path) === '') {
      const nonce = randomBytes(16).toString('base64');
      send(response, 200, page.replaceAll(NONCE_PLACEHOLDER, nonce), {
        'Content-Type': index.contentType,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': contentSecurityPolicy(nonce),
      });
    } else {
      sendText(response, 404, 'Not found.');
    }
  });
}

/** The embed host's page in the portal build (ADR 0035). */
const EMBED_PAGE = '/embed.html';

/** `slugPattern` in packages/domain, as `app.tenant.slug` checks it. */
const SLUG = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$/;

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const TOP_LABEL = '[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?';
/** `embedOriginPattern` in packages/domain: https, a DNS name of two or more labels, a port. */
const EMBED_ORIGIN = new RegExp(`^https://(?:${LABEL}\\.)+${TOP_LABEL}(?::[1-9][0-9]{0,4})?$`);
const MAX_EMBED_ORIGIN_LENGTH = 8 + 253 + 6;
const MAX_EMBED_ORIGINS = 20;

/** How long a slug's origins are kept, so a removed origin is refused within a minute. */
export const EMBED_ORIGINS_TTL_MS = 60_000;

/** The longest the API has to give a slug's origins before framing is refused. */
const EMBED_LOOKUP_TIMEOUT_MS = 2_000;

/**
 * Slugs kept at once with origins, and again without: the oldest goes first,
 * so made-up slugs cannot fill memory or push out a tenant that has origins.
 */
const MAX_KEPT_SLUGS = 1_000;

/** Far more than 20 origins take. */
const MAX_LOOKUP_BYTES = 16 * 1024;

const NOT_EMBEDDABLE =
  'We cannot find this form. Check the link for typing mistakes, or ask the organisation that shared it.';
const UNAVAILABLE = 'This form cannot be shown at the moment. Try again in a few minutes.';

/**
 * Whether `value` is an origin a tenant may list (ADR 0035), exactly as
 * stored: lower case, no path, wildcard, quote, separator or space, so it
 * can never add a directive to a policy.
 */
export function isEmbedOrigin(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_EMBED_ORIGIN_LENGTH &&
    EMBED_ORIGIN.test(value) &&
    Number(value.split(':')[2] ?? 443) <= 65_535
  );
}

/**
 * ADR 0035's policy for the embed host, whose own origin is `embed`. Only
 * the embed page has a nonce. frame-ancestors lists `ancestors`, or is
 * 'none' if the list is empty, too long or holds anything but an origin.
 */
export function embedContentSecurityPolicy(
  embed: URL,
  nonce?: string,
  ancestors: readonly unknown[] = [],
): string {
  const framing =
    ancestors.length > 0 && ancestors.length <= MAX_EMBED_ORIGINS && ancestors.every(isEmbedOrigin)
      ? ancestors.join(' ')
      : "'none'";
  return [
    "default-src 'self'",
    "script-src 'self'",
    styleSource(nonce),
    "img-src 'self'",
    "font-src 'self'",
    `connect-src ${embed.origin}${API_PATH}/public/tenants/`,
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${framing}`,
  ].join('; ');
}

/** The origins in the public route's answer, or none unless it is exactly `{ origins: [...] }`. */
function originsIn(text: string): string[] {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof body !== 'object' || body === null || Object.keys(body).join() !== 'origins') {
    return [];
  }
  const { origins } = body as { origins: unknown };
  const list: unknown[] = Array.isArray(origins) ? origins : [];
  return list.length <= MAX_EMBED_ORIGINS && list.every(isEmbedOrigin) ? list : [];
}

/**
 * A slug's origins from the API's public route, asked as the embed host
 * with no cookie, for `client`: the list; none for its 404 or an answer
 * that is not a list of origins; or null for any other answer, an error, or
 * no answer in time.
 */
function lookUpOrigins(
  api: URL,
  host: string,
  slug: string,
  client?: string,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const fail = (): void => {
      resolve(null);
    };
    const outgoing = httpRequest(
      {
        host: api.hostname,
        port: api.port,
        path: `${API_PATH}/public/tenants/${slug}/embed-origins`,
        headers: {
          host,
          accept: 'application/json',
          ...(client === undefined ? {} : { 'x-forwarded-for': client }),
        },
        signal: AbortSignal.timeout(EMBED_LOOKUP_TIMEOUT_MS),
      },
      (answer) => {
        // The first to settle wins, so 'close' after 'end' changes nothing.
        answer.on('error', fail);
        answer.on('close', fail);
        if (answer.statusCode !== 200) {
          resolve(answer.statusCode === 404 ? [] : null);
          answer.resume();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        answer.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_LOOKUP_BYTES) outgoing.destroy();
          else chunks.push(chunk);
        });
        answer.on('end', () => {
          resolve(originsIn(Buffer.concat(chunks).toString('utf8')));
        });
      },
    );
    outgoing.on('error', fail);
    outgoing.end();
  });
}

interface Kept {
  until: number;
  origins: string[];
}

/** Keep `slug` in `cache`, dropping the oldest entry when it is full. */
function keep(cache: Map<string, Kept>, slug: string, entry: Kept): void {
  const [oldest] = cache.keys();
  if (cache.size >= MAX_KEPT_SLUGS && oldest !== undefined) cache.delete(oldest);
  cache.set(slug, entry);
}

/**
 * Each slug's origins, kept for EMBED_ORIGINS_TTL_MS from when they were
 * asked for, with one lookup at a time per slug, made for the client that
 * caused it. Slugs with origins and slugs without are kept apart. A failed
 * lookup is not kept, so the next request asks again; one waiting lookup
 * lasts EMBED_LOOKUP_TIMEOUT_MS at most.
 */
export function embedOriginReader(
  api: URL,
  host: string,
  now: () => number = Date.now,
): (slug: string, client?: string) => Promise<string[] | null> {
  const withOrigins = new Map<string, Kept>();
  const without = new Map<string, Kept>();
  const asking = new Map<string, Promise<string[] | null>>();
  return (slug, client) => {
    for (const cache of [withOrigins, without]) {
      const known = cache.get(slug);
      if (known !== undefined && known.until > now()) return Promise.resolve(known.origins);
      cache.delete(slug);
    }
    const waiting = asking.get(slug);
    if (waiting !== undefined) return waiting;
    const until = now() + EMBED_ORIGINS_TTL_MS;
    const origins = lookUpOrigins(api, host, slug, client).then((found) => {
      asking.delete(slug);
      if (found !== null)
        keep(found.length > 0 ? withOrigins : without, slug, { until, origins: found });
      return found;
    });
    asking.set(slug, origins);
    return origins;
  };
}

/**
 * The client's address: the X-Forwarded-For the proxy set, which it alone
 * can send here, if it is one address; otherwise the connection's.
 */
function clientAddress(request: IncomingMessage): string | undefined {
  const forwarded = request.headers['x-forwarded-for'];
  return typeof forwarded === 'string' && isIP(forwarded) !== 0
    ? forwarded
    : request.socket.remoteAddress;
}

/** The slug an embed path starts with, as sent: /northfield/forms/{id} gives northfield. */
function embedSlug(url = '/'): string | undefined {
  let path: string;
  try {
    path = new URL(url, 'http://localhost').pathname;
  } catch {
    return undefined;
  }
  const slug = path.split('/')[1] ?? '';
  return SLUG.test(slug) && extname(path) === '' && !isApiRequest(url) ? slug : undefined;
}

/** The embed host's own origin given with --embed: https and a host, with nothing else. */
export function embedOrigin(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin + '/' !== url.href) {
    throw new Error(`--embed must be an origin such as https://embed.example.net, not ${value}.`);
  }
  return url;
}

/**
 * The embed host's server for the portal build in `root`, at the public
 * origin `embed`, reading each tenant's origins from `api`. Throws if the
 * build has no embed.html.
 */
export function createEmbedServer(root: string, embed: URL, api: URL): Server {
  const files = readBuild(root);
  const page = files.get(EMBED_PAGE)?.body.toString('utf8');
  if (page === undefined) throw new Error(`${root} has no embed.html. Build the portal first.`);
  const originsOf = embedOriginReader(api, embed.host);

  return createServer((request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    const refuse = (status: number, text: string): void => {
      sendText(response, status, text, embedContentSecurityPolicy(embed));
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      refuse(405, 'Use GET or HEAD.');
      return;
    }
    const path = requestPath(request.url);
    if (path === undefined) {
      refuse(400, 'The address is not valid.');
      return;
    }

    // A page is served only as the embed page, under a slug.
    const file = files.get(path);
    if (file && extname(path) !== '.html') {
      send(response, 200, file.body, {
        'Content-Type': file.contentType,
        'Cache-Control': file.cacheControl,
        'Content-Security-Policy': embedContentSecurityPolicy(embed),
      });
      return;
    }
    const slug = embedSlug(request.url);
    if (slug === undefined) {
      refuse(404, 'Not found.');
      return;
    }
    void originsOf(slug, clientAddress(request)).then((origins) => {
      if (origins === null) {
        refuse(503, UNAVAILABLE);
      } else if (origins.length === 0) {
        refuse(404, NOT_EMBEDDABLE);
      } else {
        const nonce = randomBytes(16).toString('base64');
        send(response, 200, page.replaceAll(NONCE_PLACEHOLDER, nonce), {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': embedContentSecurityPolicy(embed, nonce, origins),
        });
      }
    });
  });
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
      api: { type: 'string' },
      embed: { type: 'string' },
    },
  });
  if (
    values.root === undefined ||
    values.port === undefined ||
    (values.embed !== undefined && values.api === undefined)
  ) {
    console.error(
      'Usage: node scripts/web-server.ts --root <built app> --port <port> [--host <address>] [--api <API origin>] [--embed <embed origin>, with --api]',
    );
    process.exit(2);
  }
  const { root, host } = values;
  const port = Number(values.port);
  const api = values.api === undefined ? undefined : apiOrigin(values.api);
  const server =
    values.embed === undefined || api === undefined
      ? createWebServer(root, api)
      : createEmbedServer(root, embedOrigin(values.embed), api);
  server.listen(port, host, () => {
    console.log(`Serving ${root} at http://${host}:${String(port)}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close();
    });
  }
}
