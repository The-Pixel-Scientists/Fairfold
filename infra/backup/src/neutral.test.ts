// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it } from './testing.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function allFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

// Written with character classes so this file does not match itself.
const PROVIDER = /g[o]ogle|\bg[c]p\b|\bg[c]s\b|cloud[ -]?s[q]l|cloud[ -]?r[u]n|gsu[t]il/i;

describe('infra/backup', () => {
  it('names no cloud provider, so it stays portable', () => {
    const naming = allFiles(ROOT).filter((path) => PROVIDER.test(readFileSync(path, 'utf8')));
    assert.deepEqual(naming, []);
  });
});
