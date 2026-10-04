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
// Steps 2 to 4 are skipped when Vitest says the filters select no database
// test, so `pnpm test -- packages/ui` needs no database. Otherwise they need
// the development services running:
//   docker compose -f infra/compose/compose.dev.yaml up -d --wait

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repositoryRoot } from './dev-names.ts';

const DATABASE_PROJECTS = ['db-admin', 'db'];

function run(args: readonly string[]): boolean {
  const result = spawnSync(process.execPath, args, { cwd: repositoryRoot, stdio: 'inherit' });
  return result.status === 0;
}

function vitest(command: string, projects: readonly string[], forwarded: readonly string[]) {
  return [
    'scripts/vitest.ts',
    command,
    ...projects.flatMap((name) => ['--project', name]),
    ...forwarded,
  ];
}

/**
 * Whether the Vitest filters and options select any database test file.
 * Anything short of a clear "none", such as a failed or unreadable listing,
 * counts as yes, so a database test is never skipped by mistake.
 */
export function selectsDatabaseTests(forwarded: readonly string[]): boolean {
  if (forwarded.length === 0) return true;
  const folder = mkdtempSync(join(tmpdir(), 'tps-test-'));
  const listing = join(folder, 'files.json');
  try {
    // --json=<file> in one argument, so it can never take a filter as its path.
    const result = spawnSync(
      process.execPath,
      vitest('list', DATABASE_PROJECTS, [...forwarded, '--filesOnly', `--json=${listing}`]),
      { cwd: repositoryRoot, stdio: 'ignore' },
    );
    if (result.status !== 0) return true;
    const files: unknown = JSON.parse(readFileSync(listing, 'utf8'));
    return !Array.isArray(files) || files.length > 0;
  } catch {
    return true;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function main(argv: readonly string[]): number {
  const dbOnly = argv.includes('--db-only');
  const forwarded = argv.filter((argument) => argument !== '--db-only' && argument !== '--');

  const steps: string[][] = dbOnly ? [] : [vitest('run', ['unit', 'ui'], forwarded)];
  if (selectsDatabaseTests(forwarded)) {
    steps.push(
      [
        'scripts/dev-env.ts',
        'database-admin',
        'node',
        'packages/db/scripts/db.ts',
        'prepare',
        'up',
        '--test',
      ],
      ['scripts/dev-env.ts', 'database-admin', 'node', ...vitest('run', ['db-admin'], forwarded)],
      ['scripts/dev-env.ts', 'database-tests', 'node', ...vitest('run', ['db'], forwarded)],
    );
  } else {
    console.log('No database test matches, so the database steps are skipped.');
  }
  for (const step of steps) {
    if (!run(step)) return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
