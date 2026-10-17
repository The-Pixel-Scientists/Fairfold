// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The text checks in migrations 0009, 0012 and 0013 copy line() and
// paragraphs() in modules/grants/src/contracts/programme/text.ts (S04-01):
// no character that hides or reorders text, a line break allowed in
// paragraphs only, and nothing that trim() removes at either end.
// packages/db cannot import a module, so the contract's two patterns are
// copied here. This checks that every column's copy of each pattern is the
// same, then runs it over every Unicode code point, in the middle and at
// each end of a value.

import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';

/** HIDDEN and HIDDEN_IN_TEXT in the contract's text.ts. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const HIDDEN_IN_TEXT = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

const LINE_CHECKS = [
  'email_template_version_subject_text',
  'programme_summary_text',
  'programme_title_text',
  'publisher_setting_funder_name_text',
  'round_title_text',
  'rubric_criterion_label_text',
  'stage_name_text',
];
const TEXT_CHECKS = [
  'email_template_version_body_text',
  'programme_description_text',
  'rubric_criterion_guidance_text',
  'score_comment_text',
];

/** Each check in the grants schema whose name ends in _text, by name, with its pattern. */
let patterns: Map<string, string>;
beforeAll(async () => {
  const { rows } = await withClient('app_api', (client) =>
    client.query<{ name: string; definition: string }>(
      `SELECT o.conname AS name, pg_catalog.pg_get_constraintdef(o.oid) AS definition
         FROM pg_catalog.pg_constraint o
        WHERE o.connamespace = 'grants'::regnamespace AND o.contype = 'c'
          AND o.conname LIKE '%\\_text'`,
    ),
  );
  patterns = new Map(
    rows.map(({ name, definition }) => {
      const [literal = ''] = [...definition.matchAll(/'((?:[^']|'')*)'::text/g)].map((match) =>
        (match[1] ?? '').replaceAll("''", "'"),
      );
      return [name, literal];
    }),
  );
});

const LAST_CODE_POINT = 0x10ffff;

/**
 * Each code point from 1, but surrogates, that a value refuses in the
 * middle (m), at the start (s) or at the end (e), as `<point> <flags>`.
 */
function refusedByContract(hidden: RegExp): string[] {
  const refuses = (value: string) => hidden.test(value) || value.trim() !== value;
  const found: string[] = [];
  for (let point = 1; point <= LAST_CODE_POINT; point += 1) {
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const character = String.fromCodePoint(point);
    const flags = [
      refuses(`a${character}a`) ? 'm' : '',
      refuses(`${character}a`) ? 's' : '',
      refuses(`a${character}`) ? 'e' : '',
    ].join('');
    if (flags) found.push(`${String(point)} ${flags}`);
  }
  return found;
}

async function refusedByDatabase(pattern: string): Promise<string[]> {
  const { rows } = await withClient('app_api', (client) =>
    client.query<{ found: string }>(
      `SELECT p::text || ' ' || flags AS found
         FROM pg_catalog.generate_series(1, $1::integer) AS p,
              LATERAL (SELECT CASE WHEN ('a' || pg_catalog.chr(p) || 'a') ~ $2 THEN 'm' ELSE '' END
                           || CASE WHEN (pg_catalog.chr(p) || 'a') ~ $2 THEN 's' ELSE '' END
                           || CASE WHEN ('a' || pg_catalog.chr(p)) ~ $2 THEN 'e' ELSE '' END
                           AS flags) AS f
        WHERE p NOT BETWEEN 55296 AND 57343 AND flags <> ''
        ORDER BY p`,
      [LAST_CODE_POINT, pattern],
    ),
  );
  return rows.map((row) => row.found);
}

describe('the text checks in migrations 0009, 0012 and 0013', { timeout: 120_000 }, () => {
  it('give every line column one pattern, and every paragraphs column another', () => {
    expect([...patterns.keys()].sort()).toEqual([...LINE_CHECKS, ...TEXT_CHECKS].sort());
    expect(new Set(LINE_CHECKS.map((name) => patterns.get(name))).size).toBe(1);
    expect(new Set(TEXT_CHECKS.map((name) => patterns.get(name))).size).toBe(1);
  });

  it.each([
    ['line()', LINE_CHECKS[0] ?? '', HIDDEN],
    ['paragraphs()', TEXT_CHECKS[0] ?? '', HIDDEN_IN_TEXT],
  ])('refuse exactly the characters %s refuses or trims', async (_, check, hidden) => {
    expect(await refusedByDatabase(patterns.get(check) ?? '')).toEqual(refusedByContract(hidden));
  });
});
