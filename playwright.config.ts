// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end and accessibility tests (ADRs 0001 and 0006). Specs live in
// apps/console/e2e and apps/portal/e2e. Axe checks carry the @a11y tag:
// `pnpm test:a11y` runs only those, `pnpm test:e2e` runs everything, and
// `pnpm test:e2e -- console` runs one app's specs.
//
// Playwright starts each app's Vite dev server on this worktree's ports
// (scripts/dev-names.ts) and opens it as console.localhost or
// portal.localhost, the host names used in development (ADR 0005).

import { defineConfig, devices } from '@playwright/test';

import { currentDevNames } from './scripts/dev-names.ts';

const { ports } = currentDevNames();
const ci = Boolean(process.env['CI']);

function viteServer(app: 'console' | 'portal', port: number) {
  return {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: `apps/${app}`,
    // Vite serves its client script even before the app has a page.
    url: `http://127.0.0.1:${port}/@vite/client`,
    reuseExistingServer: !ci,
    timeout: 60_000,
  };
}

export default defineConfig({
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'console',
      testDir: 'apps/console/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: `http://console.localhost:${ports.console}` },
    },
    {
      name: 'portal',
      testDir: 'apps/portal/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: `http://portal.localhost:${ports.portal}` },
    },
  ],
  webServer: [viteServer('console', ports.console), viteServer('portal', ports.portal)],
});
