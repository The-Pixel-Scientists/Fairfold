// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Serves a built console or portal: the files Vite wrote, and index.html for
// any other path without a file extension, so the app's router can answer.
// The release images run it, and so do Playwright's production projects, so
// the tests see what ships.
//
//   node scripts/web-server.ts --root <built app> --port <port> [--host <address>]
//                              [--api <API origin>]
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

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
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

/** ADR 0006's policy. Only index.html has a nonce. */
export function contentSecurityPolicy(nonce?: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    nonce === undefined ? "style-src 'self'" : `style-src 'self' 'nonce-${nonce}'`,
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

function sendText(response: ServerResponse, status: number, text: string): void {
  send(response, status, `${text}\n`, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': contentSecurityPolicy(),
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

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string', default: '127.0.0.1' },
      api: { type: 'string' },
    },
  });
  if (values.root === undefined || values.port === undefined) {
    console.error(
      'Usage: node scripts/web-server.ts --root <built app> --port <port> [--host <address>] [--api <API origin>]',
    );
    process.exit(2);
  }
  const { root, host } = values;
  const port = Number(values.port);
  const server = createWebServer(
    root,
    values.api === undefined ? undefined : apiOrigin(values.api),
  );
  server.listen(port, host, () => {
    console.log(`Serving ${root} at http://${host}:${String(port)}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close();
    });
  }
}
