// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('sending mail', () => {
  it('happens in the job and nowhere else in the decisions code', () => {
    const files = readdirSync(import.meta.dirname).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    const sends = files.filter((name) =>
      /\.send\(|\bafterCommit\b/.test(readFileSync(join(import.meta.dirname, name), 'utf8')),
    );
    expect(sends).toEqual(['job.ts']);
  });
});
