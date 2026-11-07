// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The replay helper and the replay itself set a tenant from an auth event
// (ADR 0003, source 5), so only apps/api/src/auth may import them. The
// Semgrep rule follows; until then this test holds the boundary.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..', '..', '..');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const REPLAY =
  /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"`][^'"`]*audit-copy\/(?:recorded-tenant|replay)(?:\.[cm]?[jt]s)?['"`]/;

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

/** Each workspace's source and test folders, and the root scripts and e2e tests. */
function sourceRoots(): string[] {
  const workspaces = ['apps', 'packages', 'modules'].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => ['src', 'test'].map((folder) => join(root, group, entry.name, folder))),
  );
  return [...workspaces, join(root, 'scripts'), join(root, 'e2e')].filter((folder) =>
    existsSync(folder),
  );
}

describe('the audit-copy replay helper', () => {
  it('matches the ways a file can import it', () => {
    for (const line of [
      "import { copyInRecordedTenant } from '../auth/audit-copy/recorded-tenant.ts';",
      "export { replayAuthCopies } from './auth/audit-copy/replay.js';",
      "await import('../src/auth/audit-copy/replay')",
    ]) {
      expect(REPLAY.test(line), line).toBe(true);
    }
    expect(REPLAY.test("import { runAuditCopyReplay } from './audit-copy/command.ts';")).toBe(
      false,
    );
  });

  it('is imported only in apps/api/src/auth', { timeout: 30_000 }, () => {
    const outside = sourceRoots()
      .flatMap((folder) => [...sources(folder)])
      .map((path) => relative(root, path).split(sep).join('/'))
      .filter((path) => !path.startsWith('apps/api/src/auth/'))
      .filter((path) => REPLAY.test(readFileSync(join(root, path), 'utf8')));
    expect(outside).toEqual([]);
  });

  it('is not re-exported by the auth module', () => {
    const entry = readFileSync(join(root, 'apps/api/src/auth/index.ts'), 'utf8');
    expect(REPLAY.test(entry)).toBe(false);
  });
});
