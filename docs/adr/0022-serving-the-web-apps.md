# ADR 0022: Serving the web apps

- **Status:** proposed
- **Date:** 2026-10-03
- **Deciders:** Aaron Gardner

## Context

The console and portal are static builds, but [ADR 0006](0006-design-system.md)
needs each `index.html` served with a fresh nonce on every response, and its
policy and security headers on everything the apps send. A plain static file
server cannot do the first. `pnpm stack` and self-hosted installs need a
container for each app that does both, and Playwright's production projects
need to serve the builds the same way, so the tests see what ships.

Dependencies are frozen for October 2026: no dependency or image is added
beyond those already approved. The Node.js 24 base image is already approved
for the API ([ADR 0001](0001-monorepo-toolchain.md)).

## Options considered

1. **nginx**, with `sub_filter` to put `$request_id` in the page as the nonce.
   - Pros: mature, fast, does compression and TLS.
   - Cons: a new image to pin and patch during the freeze; the nonce and
     header rules live in a configuration language the tests cannot import.
2. **Caddy**, with a template for the nonce.
   - Pros: simple configuration, automatic TLS.
   - Cons: also a new image, and a templating feature to keep away from
     anything a user controls.
3. **A small Node.js server, `scripts/web-server.ts`**, using only Node.js
   built-ins, run on the approved base image.
   - Pros: no new dependency or image; one file that the release images and
     Playwright both run; its rules are unit tested.
   - Cons: ours to maintain; no compression, TLS or caching proxy of its own.

## Decision

Option 3. The server guarantees:

- Every response carries ADR 0006's Content Security Policy and security
  headers, errors included.
- `index.html` is sent with a fresh 128-bit nonce, from `node:crypto`, in the
  policy's `style-src` and in place of the placeholder that Vite's
  `html.cspNonce` writes into the page. Scripts never get a nonce.
- Files are read once, at start-up, into a map keyed by URL path. No request
  reaches the file system, so nothing outside the build can be served.
- Only `GET` and `HEAD` are answered. A path without a file extension gets
  `index.html` for the app's router; a missing file gets 404.
- Hashed files under `assets/` are cached for a year; `index.html` is never
  cached.

TLS, compression, request logs and rate limits belong to the reverse proxy in
front, chosen in the files ADR that comes before E6.

## Consequences

- One server to keep in step with ADR 0006: a change to the policy or headers
  is made in `scripts/web-server.ts` and its tests.
- When the apps first call the API, the server gains a proxy for the API's
  path, so each app stays same-origin ([ADR 0005](0005-dev-topology.md)).
- Revisit this when production puts a CDN or reverse proxy in front of the
  apps. That layer may take over the headers, compression and caching, but
  `index.html` must still get a fresh nonce on every response.
