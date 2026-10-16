// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Semgrep rule tps-better-auth-only-in-auth (ADR 0010), checked here too
// so a local test run catches a stray import before CI does.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..', '..');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const BETTER_AUTH =
  /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"`](?:better-auth|@better-auth\/)/;

function* sources(folder: string): Generator<string> {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (SOURCE.test(entry.name)) yield path;
  }
}

/** Each workspace's src folder, and the root scripts. */
function sourceRoots(): string[] {
  const workspaces = ['apps', 'packages', 'modules'].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, group, entry.name, 'src')),
  );
  return [...workspaces, join(root, 'scripts')].filter((folder) => existsSync(folder));
}

describe('Better Auth', () => {
  it('is imported only in apps/api/src/auth', { timeout: 30_000 }, () => {
    const outside = sourceRoots()
      .flatMap((folder) => [...sources(folder)])
      .map((path) => relative(root, path).split(sep).join('/'))
      .filter((path) => !path.startsWith('apps/api/src/auth/'))
      .filter((path) => BETTER_AUTH.test(readFileSync(join(root, path), 'utf8')));
    expect(outside).toEqual([]);
  });
});
