// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Serves a built console or portal: the files Vite wrote, and index.html for
// any other path without a file extension, so the app's router can answer.
// The release images run it, and so do Playwright's production projects, so
// the tests see what ships.
//
//   node scripts/web-server.ts --root <built app> --port <port> [--host <address>]
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

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
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

/** A server for the built app in `root`. Throws if it has no index.html. */
export function createWebServer(root: string): Server {
  const files = readBuild(root);
  const index = files.get('/index.html');
  if (!index) throw new Error(`${root} has no index.html. Build the app first.`);
  const page = index.body.toString('utf8');

  return createServer((request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);

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
    },
  });
  if (values.root === undefined || values.port === undefined) {
    console.error(
      'Usage: node scripts/web-server.ts --root <built app> --port <port> [--host <address>]',
    );
    process.exit(2);
  }
  const { root, host } = values;
  const port = Number(values.port);
  const server = createWebServer(root);
  server.listen(port, host, () => {
    console.log(`Serving ${root} at http://${host}:${String(port)}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close();
    });
  }
}
