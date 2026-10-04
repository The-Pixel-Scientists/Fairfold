// SPDX-License-Identifier: AGPL-3.0-or-later

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The console is served as console.localhost in development (ADR 0005), so
// the dev and preview servers accept that host name and any other *.localhost.
// cspNonce puts a placeholder on the <style> elements Vite writes into
// index.html; the web server swaps in a fresh nonce on each response (ADR 0006).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  html: { cspNonce: 'TPS_CSP_NONCE' },
  server: { allowedHosts: ['.localhost'] },
  preview: { allowedHosts: ['.localhost'] },
});
