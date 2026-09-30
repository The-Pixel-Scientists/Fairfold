// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `pnpm test` and `pnpm test:db`: every Vitest project, each with only the
// credentials it needs (scripts/dev-env.ts).
//
//   node scripts/test.ts [--db-only] [Vitest filters and options...]
//
//   1. unit and ui, with no database settings at all (skipped by --db-only);
//   2. prepare and migrate this worktree's test database, as the superuser;
//   3. db-admin: tests of the roles script and migration tooling, which
//      connect as the superuser;
//   4. db: database tests, which connect as the app roles and migrator.
//
// The database steps need the development services running:
//   docker compose -f infra/compose/compose.dev.yaml up -d --wait

import { spawnSync } from 'node:child_process';

import { repositoryRoot } from './dev-names.ts';

function run(args: readonly string[]): boolean {
  const result = spawnSync(process.execPath, args, { cwd: repositoryRoot, stdio: 'inherit' });
  return result.status === 0;
}

function main(argv: readonly string[]): number {
  const dbOnly = argv.includes('--db-only');
  const forwarded = argv.filter((argument) => argument !== '--db-only' && argument !== '--');
  const vitest = (project: string[]): string[] => [
    'scripts/vitest.ts',
    'run',
    ...project.flatMap((name) => ['--project', name]),
    ...forwarded,
  ];

  const steps: string[][] = [
    ...(dbOnly ? [] : [vitest(['unit', 'ui'])]),
    [
      'scripts/dev-env.ts',
      'database-admin',
      'node',
      'packages/db/scripts/db.ts',
      'prepare',
      'up',
      '--test',
    ],
    ['scripts/dev-env.ts', 'database-admin', 'node', ...vitest(['db-admin'])],
    ['scripts/dev-env.ts', 'database-tests', 'node', ...vitest(['db'])],
  ];
  for (const step of steps) {
    if (!run(step)) return 1;
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
