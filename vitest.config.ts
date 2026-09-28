// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One Vitest configuration for the whole workspace (ADR 0001).
//   unit      Node.js tests for packages, the API and tooling.
//   ui        Component tests in jsdom.
//   db-admin  Tests of the roles script and migration tooling, which connect
//             to PostgreSQL as the superuser. Files end in .db.test.ts.
//   db        Tests that need PostgreSQL and connect as the app roles.
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
            'packages/db/scripts/**/*.test.ts',
            'apps/api/**/*.test.ts',
            'scripts/**/*.test.ts',
          ],
          exclude: [...exclude, '**/*.db.test.ts'],
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
          ],
          exclude,
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
          include: ['packages/db/src/**/*.test.ts', 'packages/db/test/**/*.test.ts'],
          exclude,
          // Database tests share one database, so files run one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
