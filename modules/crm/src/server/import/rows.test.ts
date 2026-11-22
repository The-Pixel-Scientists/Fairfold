// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkRow, partyInput } from './rows.ts';

const person = { '1': 'given_name', '2': 'family_name', '3': 'email', '4': 'phone' } as const;
const organisation = {
  '1': 'name',
  '2': 'legal_form',
  '3': 'address_line1',
  '4': 'town',
  '5': 'postcode',
  '6': 'identifier_scheme',
  '7': 'identifier',
} as const;

const ADA = ['Ada', 'Quillfeather', 'ada.quillfeather@example.test', '+44 7700 900982'];
const HOUSE = [
  'Quillfeather Gardens',
  'Registered charity',
  '1 Test Lane',
  'Testford',
  'SW1A 1AA',
  '',
  '',
];

describe('checkRow', () => {
  it('passes a valid person and a valid organisation', () => {
    expect(checkRow('person', person, ADA, new Set())).toEqual({
      cells: {
        given_name: 'Ada',
        family_name: 'Quillfeather',
        email: 'ada.quillfeather@example.test',
        phone: '+44 7700 900982',
      },
      errors: [],
    });
    expect(checkRow('organisation', organisation, HOUSE, new Set()).errors).toEqual([]);
  });

  it.each([
    ['=', '=1+1'],
    ['+', '+cmd|calc'],
    ['-', '-2+3x'],
    ['@', '@SUM(A1)'],
    ['a tab', '\tAda'],
    ['a carriage return', '\rAda'],
  ])('refuses a cell that starts with %s and never stores it', (_name, value) => {
    const { cells, errors } = checkRow('person', person, [value, 'Q', 'q@example.test'], new Set());
    expect(errors).toEqual([{ field: 'given_name', code: 'formula' }]);
    expect(cells).not.toHaveProperty('given_name');
    expect(JSON.stringify({ cells, errors })).not.toContain('calc');
  });

  it('refuses hidden characters and a NUL byte, and does not store them', () => {
    const hidden = checkRow('person', person, ['Ad​a', 'Q', 'q@example.test'], new Set());
    expect(hidden.errors).toEqual([{ field: 'given_name', code: 'hidden_characters' }]);
    expect(hidden.cells).not.toHaveProperty('given_name');
    const nul = checkRow('person', person, ['Ada', 'Q', 'q\0@example.test'], new Set());
    expect(nul.errors).toEqual([{ field: 'email', code: 'hidden_characters' }]);
    expect(nul.cells).not.toHaveProperty('email');
  });

  it('flags a missing required field and an unknown legal form by code', () => {
    const { errors } = checkRow(
      'organisation',
      organisation,
      ['', 'Not a legal form', '1 Test Lane', 'Testford', 'SW1A 1AA', '', ''],
      new Set(),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        { field: 'name', code: 'required' },
        { field: 'legal_form', code: 'not_in_list' },
      ]),
    );
  });

  it('cuts a very long cell and flags it', () => {
    const { cells, errors } = checkRow(
      'person',
      person,
      ['A'.repeat(5000), 'Q', 'q@example.test'],
      new Set(),
    );
    expect(errors).toEqual([{ field: 'given_name', code: 'too_long' }]);
    expect(cells.given_name).toHaveLength(500);
  });

  it('refuses the same record twice in one file, whatever its case', () => {
    const seen = new Set<string>();
    expect(checkRow('person', person, ADA, seen).errors).toEqual([]);
    const again = [...ADA];
    again[2] = 'ADA.Quillfeather@example.test';
    expect(checkRow('person', person, again, seen).errors).toEqual([
      { field: 'email', code: 'repeated_in_file' },
    ]);
    expect(checkRow('organisation', organisation, HOUSE, seen).errors).toEqual([]);
    expect(checkRow('organisation', organisation, HOUSE, seen).errors).toEqual([
      { field: 'name', code: 'repeated_in_file' },
    ]);
  });

  it('treats a short row as missing its later fields', () => {
    expect(checkRow('person', person, ['Ada'], new Set()).errors).toEqual([
      { field: 'family_name', code: 'required' },
      { field: 'email', code: 'required' },
    ]);
  });
});

describe('partyInput', () => {
  it('builds records that party accepts, with an identifier as claimed', () => {
    const { cells } = checkRow('person', person, ADA, new Set());
    expect(partyInput('person', cells)).toEqual({
      kind: 'person',
      input: {
        givenName: 'Ada',
        familyName: 'Quillfeather',
        email: 'ada.quillfeather@example.test',
        phone: '+44 7700 900982',
      },
    });
    const row = [...HOUSE];
    row[5] = 'gb-chc';
    row[6] = '1234567';
    const checked = checkRow('organisation', organisation, row, new Set());
    expect(checked.errors).toEqual([]);
    expect(partyInput('organisation', checked.cells)).toMatchObject({
      kind: 'organisation',
      input: {
        name: 'Quillfeather Gardens',
        legalForm: 'registered_charity',
        identifiers: [{ scheme: 'GB-CHC', identifier: '1234567' }],
      },
    });
  });
});
