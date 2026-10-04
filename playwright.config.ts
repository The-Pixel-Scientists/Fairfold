// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end and accessibility tests (ADRs 0001 and 0006). Specs live in
// apps/console/e2e and apps/portal/e2e, and import `test` and `expect` from
// scripts/e2e/fixtures.ts, which fails a test on any Content Security Policy
// violation. Axe checks carry the @a11y tag: `pnpm test:a11y` runs only
// those, `pnpm test:e2e` runs everything, and `pnpm test:e2e -- console`
// runs one app's specs.
//
// `pnpm test:e2e` runs each spec against two builds of each app:
//   console, portal                        the Vite dev servers;
//   console-production, portal-production  production builds, served by
//                                          scripts/web-server.ts as the release
//                                          images serve them, under the policy.
// Tests tagged @gallery use the development-only component gallery, which
// production builds leave out: console-gallery runs them, under the policy,
// against a build made with NODE_ENV=development. The csp-console and
// csp-portal projects check each app's headers and nonce, and the fixture
// itself. In CI a test that passes only on a retry fails the run, so a
// violation that comes and goes is not missed.
//
// `pnpm test:stack` runs the same specs against a running `pnpm stack`
// instead, and starts no servers.
//
// Every server uses this worktree's ports (scripts/dev-names.ts), and apps
// are opened as console.localhost and portal.localhost (ADR 0005).

import { defineConfig, devices, type Project } from '@playwright/test';

import { currentDevNames } from './scripts/dev-names.ts';

const { ports } = currentDevNames();
const ci = Boolean(process.env['CI']);
const stack = process.env['TPS_E2E_STACK'] === '1';

type App = 'console' | 'portal';

/** Where console-gallery's build goes, out of the way of the production build in dist. */
const GALLERY_BUILD = '../../node_modules/.cache/tps/console-gallery';

function viteServer(app: App, port: number) {
  return {
    command: `pnpm exec vite --host 127.0.0.1 --port ${String(port)} --strictPort`,
    cwd: `apps/${app}`,
    // Vite serves its client script even before the app has a page.
    url: `http://127.0.0.1:${String(port)}/@vite/client`,
    reuseExistingServer: !ci,
    timeout: 60_000,
  };
}

/** Build an app, then serve the build as the release image does. */
function buildServer(app: App, port: number, outDir: string, nodeEnv: string) {
  return {
    command:
      `pnpm exec vite build --outDir ${outDir} --emptyOutDir && ` +
      `node ../../scripts/web-server.ts --root ${outDir} --port ${String(port)}`,
    cwd: `apps/${app}`,
    env: { NODE_ENV: nodeEnv },
    url: `http://127.0.0.1:${String(port)}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  };
}

function project(name: string, app: App, port: number, options: Project = {}): Project {
  return {
    name,
    testDir: `apps/${app}/e2e`,
    use: { ...devices['Desktop Chrome'], baseURL: `http://${app}.localhost:${String(port)}` },
    ...options,
  };
}

const withoutGallery = { grepInvert: /@gallery/ };
const policyChecks = { testDir: 'scripts/e2e' };

const projects = stack
  ? [
      project('console-stack', 'console', ports.stackConsole, withoutGallery),
      project('portal-stack', 'portal', ports.stackPortal),
      project('csp-console', 'console', ports.stackConsole, policyChecks),
      project('csp-portal', 'portal', ports.stackPortal, policyChecks),
    ]
  : [
      project('console', 'console', ports.console),
      project('portal', 'portal', ports.portal),
      project('console-production', 'console', ports.consoleBuild, withoutGallery),
      project('portal-production', 'portal', ports.portalBuild),
      project('console-gallery', 'console', ports.galleryBuild, { grep: /@gallery/ }),
      project('csp-console', 'console', ports.consoleBuild, policyChecks),
      project('csp-portal', 'portal', ports.portalBuild, policyChecks),
    ];

const webServer = stack
  ? []
  : [
      viteServer('console', ports.console),
      viteServer('portal', ports.portal),
      buildServer('console', ports.consoleBuild, 'dist', 'production'),
      buildServer('portal', ports.portalBuild, 'dist', 'production'),
      // NODE_ENV=development keeps the gallery in, without the dev server's inline script.
      buildServer('console', ports.galleryBuild, GALLERY_BUILD, 'development'),
    ];

export default defineConfig({
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  failOnFlakyTests: ci,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects,
  webServer,
});
