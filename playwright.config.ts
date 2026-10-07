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
// The @a11y specs also run on the production builds in Firefox and WebKit.
// Tests tagged @gallery use the development-only component gallery, which
// production builds leave out: console-gallery runs them, under the policy,
// against a build made with NODE_ENV=development. The csp-console and
// csp-portal projects check each app's headers and nonce, the fixture
// itself, and that the build has no development-only pages. In CI a test
// that passes only on a retry fails the run, so a violation that comes and
// goes is not missed.
//
// Untagged specs stub the API. Specs tagged @api need the real one, with
// Mailpit, so they run only against the stack: `pnpm stack`, then
// `pnpm test:stack`, which runs every spec there and starts no servers. The
// journey project runs the specs in the root e2e/ folder, which work through
// both apps; they read the portal's address, Mailpit's and the seed password
// file from TPS_E2E_PORTAL_URL, TPS_MAILPIT_URL and
// TPS_SEED_PASSWORD_FILE.
//
// Every server uses this worktree's ports (scripts/dev-names.ts), and apps
// are opened as console.localhost and portal.localhost (ADR 0005). Their
// /api/ goes to this worktree's `pnpm dev` API, if it is running.

import { homedir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices, type Project } from '@playwright/test';

import { currentDevNames } from './scripts/dev-names.ts';

const { ports, stackProject } = currentDevNames();
const ci = Boolean(process.env['CI']);
const stack = process.env['TPS_E2E_STACK'] === '1';
const apiOrigin = `http://127.0.0.1:${String(ports.api)}`;

type App = 'console' | 'portal';

/** Where console-gallery's build goes, out of the way of the production build in dist. */
const GALLERY_BUILD = '../../node_modules/.cache/tps/console-gallery';

function viteServer(app: App, port: number) {
  return {
    command: `pnpm exec vite --host 127.0.0.1 --port ${String(port)} --strictPort`,
    cwd: `apps/${app}`,
    env: { TPS_API_ORIGIN: apiOrigin },
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
      `node ../../scripts/web-server.ts --root ${outDir} --port ${String(port)} --api ${apiOrigin}`,
    cwd: `apps/${app}`,
    env: { NODE_ENV: nodeEnv },
    url: `http://127.0.0.1:${String(port)}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  };
}

const appURL = (app: App, port: number): string => `http://${app}.localhost:${String(port)}`;

function project(name: string, app: App, port: number, options: Project = {}): Project {
  return {
    name,
    testDir: `apps/${app}/e2e`,
    use: { ...devices['Desktop Chrome'], baseURL: appURL(app, port) },
    ...options,
  };
}

/** The @a11y specs on a production build, in another browser. */
function a11yProject(app: App, port: number, browser: 'Firefox' | 'WebKit'): Project {
  return project(`${app}-production-${browser.toLowerCase()}`, app, port, {
    grep: /@a11y/,
    grepInvert: /@gallery|@api/,
    use: {
      ...devices[browser === 'WebKit' ? 'Desktop Safari' : 'Desktop Firefox'],
      baseURL: appURL(app, port),
    },
  });
}

const withoutStack = { grepInvert: /@gallery|@api/ };
const policyChecks = { testDir: 'scripts/e2e' };

if (stack) {
  process.env['TPS_E2E_PORTAL_URL'] = appURL('portal', ports.stackPortal);
  process.env['TPS_MAILPIT_URL'] = `http://127.0.0.1:${String(ports.stackMail)}`;
  process.env['TPS_SEED_PASSWORD_FILE'] = join(
    homedir(),
    '.tps',
    'stack',
    stackProject,
    'TPS_STACK_SEED_PASSWORD',
  );
}

const projects = stack
  ? [
      project('console-stack', 'console', ports.stackConsole, { grepInvert: /@gallery/ }),
      project('portal-stack', 'portal', ports.stackPortal, { grepInvert: /@gallery/ }),
      project('csp-console', 'console', ports.stackConsole, policyChecks),
      project('csp-portal', 'portal', ports.stackPortal, policyChecks),
      project('journey', 'console', ports.stackConsole, { testDir: 'e2e' }),
    ]
  : [
      project('console', 'console', ports.console, { grepInvert: /@api/ }),
      project('portal', 'portal', ports.portal, { grepInvert: /@api/ }),
      project('console-production', 'console', ports.consoleBuild, withoutStack),
      project('portal-production', 'portal', ports.portalBuild, withoutStack),
      a11yProject('console', ports.consoleBuild, 'Firefox'),
      a11yProject('console', ports.consoleBuild, 'WebKit'),
      a11yProject('portal', ports.portalBuild, 'Firefox'),
      a11yProject('portal', ports.portalBuild, 'WebKit'),
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
