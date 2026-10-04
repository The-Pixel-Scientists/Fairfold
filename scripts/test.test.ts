// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { repositoryRoot } from './dev-names.ts';
import { selectsDatabaseTests } from './test.ts';

// Each check runs `vitest list` in a process of its own.
vi.setConfig({ testTimeout: 60_000 });

const DATABASE_TEST = 'packages/db/test/tenant-context.test.ts';
const UI_FILTER = 'packages/ui/src/SkipLink';

/** Every changed or new file in the checkout, as git sees it. */
function changedFiles(): string {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function hashOf(path: string): string {
  return createHash('sha256')
    .update(readFileSync(join(repositoryRoot, path)))
    .digest('hex');
}

describe('selectsDatabaseTests', () => {
  it('finds a database test named by a filter, and leaves the file as it was', () => {
    const before = { files: changedFiles(), test: hashOf(DATABASE_TEST) };

    expect(selectsDatabaseTests([DATABASE_TEST])).toBe(true);

    expect(hashOf(DATABASE_TEST)).toBe(before.test);
    expect(changedFiles()).toBe(before.files);
  });

  it('finds none for a filter that selects only component tests, and writes nothing', () => {
    const before = changedFiles();

    expect(selectsDatabaseTests([UI_FILTER])).toBe(false);

    expect(existsSync(join(repositoryRoot, UI_FILTER))).toBe(false);
    expect(changedFiles()).toBe(before);
  });

  it('runs the database steps when Vitest cannot list the files', () => {
    expect(selectsDatabaseTests(['--no-such-option'])).toBe(true);
  });

  it('runs every step when there is no filter', () => {
    expect(selectsDatabaseTests([])).toBe(true);
  });
});
