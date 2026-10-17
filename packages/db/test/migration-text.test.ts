// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every migration file is printable ASCII and line feeds, so a reviewer
// reads exactly what PostgreSQL runs. A raw invisible or bidirectional
// character can hide or reorder text in an editor or a diff (Trojan Source,
// CVE-2021-42574); a migration writes any other character as an escape,
// such as \u202e in a regular expression. The rest of the package may hold
// visible non-ASCII text (test data such as an accented name), but no file
// in it holds an invisible or bidirectional control character.

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../scripts/migrations.ts';

const PACKAGE_FOLDER = dirname(MIGRATIONS_FOLDER);

/** Any character other than printable ASCII (each line is split on line feeds). */
const NOT_PRINTABLE_ASCII = /[^\x20-\x7e]/gu;

/** Bidirectional controls and invisible format characters (Trojan Source). */
const HIDDEN = /[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

/** Every file under `folder`, skipping installed packages and dot folders. */
async function filesUnder(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        files.push(...(await filesUnder(path)));
      }
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

/** Each match of `pattern` in the files under `folder`, as `<file>:<line> U+<hex>`. */
async function scan(folder: string, pattern: RegExp): Promise<{ files: number; found: string[] }> {
  const files = await filesUnder(folder);
  const found: string[] = [];
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    for (const [index, line] of lines.entries()) {
      for (const character of line.matchAll(pattern)) {
        const point = (character[0].codePointAt(0) ?? 0).toString(16).padStart(4, '0');
        found.push(`${relative(folder, file)}:${String(index + 1)} U+${point}`);
      }
    }
  }
  return { files: files.length, found };
}

describe('migration files', () => {
  it('hold only printable ASCII and line feeds', async () => {
    const { files, found } = await scan(MIGRATIONS_FOLDER, NOT_PRINTABLE_ASCII);
    expect(files).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});

describe('package files', () => {
  it('hold no invisible or bidirectional control character', async () => {
    const { files, found } = await scan(PACKAGE_FOLDER, HIDDEN);
    expect(files).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });

  it('are scanned with a check that finds a planted override', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'db-text-'));
    try {
      await writeFile(
        join(folder, 'planted.ts'),
        `// ok\n// such as ${String.fromCodePoint(0x202e)}\n`,
      );
      expect((await scan(folder, HIDDEN)).found).toEqual(['planted.ts:2 U+202e']);
      expect((await scan(folder, NOT_PRINTABLE_ASCII)).found).toEqual(['planted.ts:2 U+202e']);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
