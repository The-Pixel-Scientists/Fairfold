// SPDX-License-Identifier: AGPL-3.0-or-later

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The console is served as console.localhost in development (ADR 0005), so
// the dev and preview servers accept that host name and any other *.localhost.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { allowedHosts: ['.localhost'] },
  preview: { allowedHosts: ['.localhost'] },
});
