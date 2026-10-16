// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks on app.file (migration 0008) copy the file contracts in
// packages/domain/src/files (S06-05). This reads each check back from the
// database and compares it with what it copies, and runs the name patterns
// over every Unicode code point against fileNameSchema, so neither can change
// alone.

import {
  fileNameSchema,
  fileTypes,
  MAX_FILE_BYTES,
  MAX_FILE_NAME_LENGTH,
  scanStates,
} from '@pixel-scientists/domain/files';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';

/** Each check on app.file, by name, as pg_get_constraintdef prints it. */
let checks: Map<string, string>;
beforeAll(async () => {
  const { rows } = await withClient('app_api', (client) =>
    client.query<{ name: string; definition: string }>(
      `SELECT o.conname AS name, pg_catalog.pg_get_constraintdef(o.oid) AS definition
         FROM pg_catalog.pg_constraint o
        WHERE o.conrelid = 'app.file'::regclass AND o.contype = 'c'`,
    ),
  );
  checks = new Map(rows.map((row) => [row.name, row.definition]));
});

function check(name: string): string {
  const definition = checks.get(name);
  if (definition === undefined) throw new Error(`There is no check named ${name}.`);
  return definition;
}

/** The text literals in a check, in order. */
function literals(name: string): string[] {
  return [...check(name).matchAll(/'((?:[^']|'')*)'::text/g)].map((match) =>
    (match[1] ?? '').replaceAll("''", "'"),
  );
}

const LAST_CODE_POINT = 0x10ffff;
const isSurrogate = (point: number) => point >= 0xd800 && point <= 0xdfff;

/** The code points, from 1, for which `test` holds. */
function codePoints(test: (character: string) => boolean): number[] {
  const found: number[] = [];
  for (let point = 1; point <= LAST_CODE_POINT; point += 1) {
    if (!isSurrogate(point) && test(String.fromCodePoint(point))) found.push(point);
  }
  return found;
}

/** The code points, from 1, for which `<character> ~ <pattern>` holds in the database. */
async function matchedInDatabase(pattern: string, suffix = ''): Promise<number[]> {
  const { rows } = await withClient('app_api', (client) =>
    client.query<{ point: number }>(
      `SELECT p AS point FROM pg_catalog.generate_series(1, $1::integer) AS p
        WHERE p NOT BETWEEN 55296 AND 57343 AND (pg_catalog.chr(p) || $3) ~ $2
        ORDER BY p`,
      [LAST_CODE_POINT, pattern, suffix],
    ),
  );
  return rows.map((row) => row.point);
}

describe('the checks on app.file', { timeout: 60_000 }, () => {
  it.each([
    ['file types', 'file_content_type_check', fileTypes],
    ['scan states', 'file_scan_state_check', scanStates],
  ])('allow exactly the %s in the domain package', (_, name, expected) => {
    expect(literals(name).sort()).toEqual([...expected].sort());
  });

  it('allow a file of 1 to MAX_FILE_BYTES and a name of 1 to MAX_FILE_NAME_LENGTH', () => {
    expect(check('file_size_bytes_check')).toBe(
      `CHECK (((size_bytes >= 1) AND (size_bytes <= ${String(MAX_FILE_BYTES)})))`,
    );
    expect(check('file_name_length')).toBe(
      `CHECK (((char_length(name) >= 1) AND (char_length(name) <= ${String(MAX_FILE_NAME_LENGTH)})))`,
    );
  });

  it('refuse exactly the characters fileNameSchema refuses', async () => {
    const [pattern = ''] = literals('file_name_characters');
    const refused = codePoints((character) => !fileNameSchema.safeParse(`a${character}a`).success);
    expect(await matchedInDatabase(pattern)).toEqual(refused);
  });

  it('refuse at either end exactly the characters fileNameSchema trims', async () => {
    const [pattern = ''] = literals('file_name_trimmed');
    const trimmed = codePoints((character) => {
      const parsed = fileNameSchema.safeParse(`${character}a`);
      return parsed.success && parsed.data !== `${character}a`;
    });
    expect(await matchedInDatabase(pattern, 'a')).toEqual(trimmed);
  });
});
