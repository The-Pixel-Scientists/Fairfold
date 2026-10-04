// SPDX-License-Identifier: AGPL-3.0-or-later

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';

// Where `/api` goes, so the console reaches the API on its own origin, as it
// does in production. Only this file reads the variable, and nothing in the
// bundle can, since no `envPrefix` exposes it.
const apiOrigin = process.env['TPS_API_ORIGIN'];

// The browser's own X-Forwarded-* headers are the client's to forge, so they
// are dropped and replaced. The Host header stays as the browser sent it, so
// the API can tell the console from the portal.
const apiProxy: Record<string, ProxyOptions> | undefined = apiOrigin
  ? {
      '/api': {
        target: apiOrigin,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, request) => {
            for (const name of proxyReq.getHeaderNames()) {
              if (name.startsWith('x-forwarded-')) proxyReq.removeHeader(name);
            }
            proxyReq.setHeader('x-forwarded-for', request.socket.remoteAddress ?? '');
            proxyReq.setHeader('x-forwarded-host', request.headers.host ?? '');
            proxyReq.setHeader('x-forwarded-proto', 'http');
          });
        },
      },
    }
  : undefined;

// The console is served as console.localhost in development (ADR 0005), so
// the dev and preview servers accept that host name and any other *.localhost.
// cspNonce puts a placeholder on the <style> elements Vite writes into
// index.html; the web server swaps in a fresh nonce on each response (ADR 0006).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  html: { cspNonce: 'TPS_CSP_NONCE' },
  server: { allowedHosts: ['.localhost'], proxy: apiProxy },
  preview: { allowedHosts: ['.localhost'], proxy: apiProxy },
});
