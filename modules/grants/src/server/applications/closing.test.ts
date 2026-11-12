// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rule for when an application closes lives in closing.ts alone, which
// calls the contract's effectiveClosingTime(): the scope rule, starting,
// submitting, uploading and the lateness flag cannot disagree.

import { readdirSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const folder = new URL('../', import.meta.url);

/** Set-up code that edits a round's own times, and the list of rounds that are open by them. */
const OWN_TIMES = /^(programme\/|warehouse|monitoring\/aggregate\.ts$|applications\/rounds\.ts$)/;

describe('a closing time', () => {
  it('is compared only in closing.ts, outside the round set-up and the open rounds list', () => {
    const files = readdirSync(folder, { recursive: true, encoding: 'utf8' })
      .map((file) => file.replaceAll(sep, '/'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => !OWN_TIMES.test(file));
    expect(files).toContain('applications/closing.ts');
    for (const file of files) {
      const source = readFileSync(new URL(file, folder), 'utf8');
      expect(source, file).not.toMatch(/(where|eb)\(\s*'(r\.)?closes_at'/);
    }
    expect(readFileSync(new URL('applications/closing.ts', folder), 'utf8')).toContain(
      'effectiveClosingTime(',
    );
  });
});
