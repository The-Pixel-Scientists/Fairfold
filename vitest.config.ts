// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One Vitest configuration for the whole workspace (ADR 0001).
//   unit      Node.js tests for packages, module contracts and server code,
//             the API and tooling.
//   ui        Component tests in jsdom, module screens included.
//   db-admin  Tests of the roles script and migration tooling, which connect
//             to PostgreSQL as the superuser. Files end in .db.test.ts.
//   db        Tests that need PostgreSQL and connect as the app roles: those
//             in packages/db/test, and the API's and modules', which end in
//             .integration.test.ts.
// `pnpm check` runs unit and ui. `pnpm test:db` runs db-admin and db, each
// with only the credentials it needs; `pnpm test` runs all four
// (scripts/test.ts).

import { defineConfig } from 'vitest/config';

const exclude = ['**/node_modules/**', '**/dist/**', '**/e2e/**'];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/domain/**/*.test.ts',
            'packages/config/**/*.test.ts',
            'packages/db/src/**/*.test.ts',
            'packages/db/scripts/**/*.test.ts',
            'modules/*/src/contracts/**/*.test.ts',
            'modules/*/src/server/**/*.test.ts',
            'apps/api/**/*.test.ts',
            'scripts/**/*.test.ts',
            'eslint.config.test.ts',
          ],
          exclude: [...exclude, '**/*.db.test.ts', '**/*.integration.test.ts'],
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: [
            'packages/ui/**/*.test.{ts,tsx}',
            'apps/console/**/*.test.{ts,tsx}',
            'apps/portal/**/*.test.{ts,tsx}',
            'modules/*/src/console/**/*.test.{ts,tsx}',
            'modules/*/src/portal/**/*.test.{ts,tsx}',
          ],
          exclude,
          // With Vitest's globals, Testing Library unmounts what each test
          // rendered when the test ends.
          globals: true,
          setupFiles: ['scripts/vitest-dom-setup.ts'],
          // Typing into a form with user-event can take several seconds on a
          // busy machine or a small CI runner, past Vitest's five-second default.
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: 'db-admin',
          environment: 'node',
          include: ['packages/db/scripts/**/*.db.test.ts'],
          exclude,
          // These change server-wide roles, so files run one at a time.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'db',
          environment: 'node',
          include: [
            'packages/db/test/**/*.test.ts',
            'apps/api/**/*.integration.test.ts',
            'modules/*/src/**/*.integration.test.ts',
          ],
          exclude,
          // Database tests share one database, so files run one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
