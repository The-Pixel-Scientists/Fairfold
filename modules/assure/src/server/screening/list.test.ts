// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { checkList, MAX_NAMES } from './list.ts';

const fixture = readFileSync(new URL('./fixtures/sanctions-list.json', import.meta.url), 'utf8');

/** The fixture with the designation at `index` changed. */
const changed = (index: number, change: Record<string, unknown>): string => {
  const file = JSON.parse(fixture) as { designations: Record<string, unknown>[] };
  file.designations[index] = { ...file.designations[index], ...change };
  return JSON.stringify(file);
};

const names = (...list: [string, string][]) => ({
  names: list.map(([type, name]) => ({ type, name })),
});

describe('checkList', () => {
  it('turns the fixture into one row per name, normalised as the matcher does', () => {
    const checked = checkList(fixture, null, 1);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.publishedOn).toBe('2026-11-16');
    expect(checked.rows.map((row) => row.normalised_name)).toEqual([
      'zorvan quillbright',
      'zorvan q brightquill',
      'mirela tavendish orr',
      'nandu oleksy brandvik',
      'northgate invented holdings',
      'nih trading',
      'brightwater test foundation',
      'mv invented star',
    ]);
    expect(checked.rows[0]).toMatchObject({
      designation_id: 'TST0001',
      entry_kind: 'individual',
      name_type: 'primary',
      dates_of_birth: ['1970-02-03', '1971'],
      nationalities: ['Testland'],
      country: 'Testland',
    });
    expect(JSON.stringify(checked.rows)).not.toContain('unusedField');
  });

  it('keeps no personal details on an entity', () => {
    const checked = checkList(
      changed(3, { datesOfBirth: ['1970'], nationalities: ['X'], country: 'X' }),
      null,
      1,
    );
    expect(
      checked.ok && checked.rows.find((row) => row.designation_id === 'TST0004'),
    ).toMatchObject({ dates_of_birth: [], nationalities: [], country: null });
  });

  it.each([
    ['text that is not JSON', 'not json', 'list_refused'],
    ['a date that is not a date', changed(0, { designatedOn: '2024-02-31' }), 'list_refused'],
    [
      'a partial date of birth that is not one',
      changed(0, { datesOfBirth: ['1970-13'] }),
      'list_refused',
    ],
    [
      'a control character in a name',
      changed(0, names(['primary', 'Bad\u0007Name'])),
      'list_refused',
    ],
    ['a name that is too long', changed(0, names(['primary', 'x'.repeat(301)])), 'list_refused'],
    [
      'more aliases than the cap',
      changed(
        0,
        names(
          ['primary', 'A One'],
          ...Array.from({ length: MAX_NAMES }, (_, n): [string, string] => ['alias', `Alias ${n}`]),
        ),
      ),
      'list_refused',
    ],
    ['no primary name', changed(0, names(['alias', 'Only Alias'])), 'list_refused'],
    [
      'two primary names',
      changed(0, names(['primary', 'One'], ['primary', 'Two'])),
      'list_refused',
    ],
    ['a name with no letters', changed(0, names(['primary', '---'])), 'list_refused'],
    ['an unknown kind', changed(0, { kind: 'person' }), 'list_refused'],
    ['a reference that is not safe to store', changed(0, { id: "x'; drop" }), 'list_refused'],
    ['a repeated list reference', changed(1, { id: 'TST0001' }), 'list_duplicates'],
  ])('refuses %s', (_name, body, failure) => {
    expect(checkList(body, null, 1)).toEqual({ ok: false, failure });
  });

  it('refuses a list with too few designations', () => {
    expect(checkList(fixture, null, 7)).toEqual({ ok: false, failure: 'list_too_small' });
  });

  it('refuses a list more than 10% smaller than the live version, and accepts one within it', () => {
    expect(checkList(fixture, 9, 1)).toEqual({ ok: false, failure: 'list_shrank' });
    expect(checkList(fixture, 8, 1).ok).toBe(true);
    expect(checkList(fixture, 8.8, 1).ok).toBe(true);
  });

  it('carries nothing from the file into a refusal', () => {
    const refusal = checkList(changed(0, { id: 'SECRET NAME' }), null, 1);
    expect(refusal.ok).toBe(false);
    expect(JSON.stringify(refusal)).not.toContain('SECRET');
  });
});
