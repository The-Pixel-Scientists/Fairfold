// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rule 9 for approvals (ADR 0038): only a named member's request changes an
// approval. No worker handler, job, timer or module code decides, withdraws
// or closes a request; the service in this folder is the one writer.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const src = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const root = join(src, '..', '..', '..');

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const WRITES = /\.(?:decide|withdraw)\(|approval_(?:request|decision)|workflow\.request\(/;

describe('who can change an approval', () => {
  it('is the service alone, and no worker, job or timer calls it', () => {
    const offenders = [
      ...sources(src),
      ...sources(join(root, 'modules')),
      ...sources(join(root, 'packages', 'db', 'src', 'jobs')),
    ]
      .filter((path) => !path.startsWith(join(src, 'platform', 'approvals') + sep))
      .filter((path) => WRITES.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));

    expect(offenders).toEqual([]);
  });

  it('is never reached from a worker handler or the reminder job', () => {
    for (const path of [
      ...sources(join(src, 'worker')),
      join(src, 'worker.ts'),
      join(src, 'reminders.ts'),
    ]) {
      expect(readFileSync(path, 'utf8'), relative(root, path)).not.toMatch(/approval|workflow/i);
    }
  });
});
