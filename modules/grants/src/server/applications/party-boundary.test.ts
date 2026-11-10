// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Grants reaches the party module only through its published server contract
// (ADR 0016): party stays the only writer of party tables.

import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const folder = new URL('../', import.meta.url);

describe('the grants server', () => {
  it('queries no party table and imports no generated party types', () => {
    const files = readdirSync(folder, { recursive: true, encoding: 'utf8' })
      .map((file) => file.replaceAll(sep, '/'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));
    expect(files).toContain('applications/submit.ts');
    for (const file of files) {
      const source = readFileSync(new URL(file, folder), 'utf8');
      expect(source, file).not.toMatch(/generated\/party/);
      expect(source, file).not.toMatch(
        /(selectFrom|insertInto|updateTable|deleteFrom)\(\s*'party\./,
      );
    }
  });
});
