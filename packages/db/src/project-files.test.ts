// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every TypeScript file in this package is type-checked and linted, and every
// test file runs in the Vitest project its name and folder call for. A folder
// left out of tsconfig.json or vitest.config.ts would otherwise be skipped
// without a word: `passWithNoTests` passes a filter that selects nothing.

import { globSync, readFileSync } from 'node:fs';
import { posix, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageDir = resolve(import.meta.dirname, '..');
const root = resolve(packageDir, '../..');
const prefix = 'packages/db/';

const files = globSync('**/*.ts', {
  cwd: packageDir,
  exclude: (path) => path.split(/[\\/]/).includes('node_modules'),
})
  .map((path) => path.split(sep).join('/'))
  .sort();

interface Project {
  readonly test: {
    readonly name: string;
    readonly include: readonly string[];
    readonly exclude: readonly string[];
  };
}

/** The Vitest projects that collect `path`, relative to the repository root. */
function projectsFor(projects: readonly Project[], path: string): string[] {
  const matches = (globs: readonly string[]) => globs.some((glob) => posix.matchesGlob(path, glob));
  return projects
    .filter(({ test }) => matches(test.include) && !matches(test.exclude))
    .map(({ test }) => test.name);
}

/** Tests that connect to PostgreSQL run in a database project; the rest in `unit`. */
function expectedProject(path: string): string {
  if (path.endsWith('.db.test.ts')) return 'db-admin';
  if (path.startsWith('test/') || path.endsWith('.integration.test.ts')) return 'db';
  return 'unit';
}

describe('the db package', () => {
  it('type-checks and lints every TypeScript file', () => {
    // tsconfig.json may open with comments, which JSON does not allow.
    const tsconfig = readFileSync(resolve(packageDir, 'tsconfig.json'), 'utf8');
    const { include } = JSON.parse(tsconfig.replace(/^\s*\/\/.*$/gm, '')) as {
      include: string[];
    };
    const unchecked = files.filter(
      (path) => !include.some((entry) => path === entry || path.startsWith(`${entry}/`)),
    );
    expect(unchecked).toEqual([]);
  });

  it('runs each test file once, in the project it needs', async () => {
    const config: unknown = await import(pathToFileURL(resolve(root, 'vitest.config.ts')).href);
    const { projects } = (config as { default: { test: { projects: Project[] } } }).default.test;
    const tests = files.filter((path) => path.endsWith('.test.ts'));
    expect(tests.length).toBeGreaterThan(0);
    expect(
      Object.fromEntries(tests.map((path) => [path, projectsFor(projects, prefix + path)])),
    ).toEqual(Object.fromEntries(tests.map((path) => [path, [expectedProject(path)]])));
  });
});
