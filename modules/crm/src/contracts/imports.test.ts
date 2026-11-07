// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { importRowErrors, importStartSchema, isFormulaCell } from './imports.ts';
import { crmMessages, importRowMessages } from './messages.ts';

const fileId = '0190f0a0-0000-7000-8000-000000000001';

const people = {
  fileId,
  target: 'person',
  headerRow: true,
  mapping: [
    { column: 1, field: 'given_name' },
    { column: 2, field: 'family_name' },
    { column: 3, field: 'email' },
  ],
};

const withColumn = (column: number, field: string) => ({
  ...people,
  mapping: [...people.mapping, { column, field }],
});

const messages = (input: unknown) =>
  importStartSchema.safeParse(input).error?.issues.map((issue) => issue.message);

describe('import mapping', () => {
  it('maps columns to the fixed fields of the target', () => {
    expect(importStartSchema.safeParse(people).success).toBe(true);
    expect(messages(withColumn(4, 'legal_form'))).toEqual([crmMessages.importField]);
    expect(messages(withColumn(4, 'notes'))).toEqual([crmMessages.importField]);
  });

  it('needs every required field, each field and column once, and columns 1 to 50', () => {
    expect(messages({ ...people, mapping: people.mapping.slice(0, 2) })).toEqual([
      crmMessages.importRequired,
    ]);
    expect(messages(withColumn(1, 'phone'))).toEqual([crmMessages.listedOnce]);
    expect(messages(withColumn(51, 'phone'))).toEqual([crmMessages.importColumn]);
  });

  it('names no importer, and cannot ask to verify, link or merge', () => {
    for (const extra of ['importedBy', 'verify', 'verified', 'merge', 'linkTo']) {
      expect(importStartSchema.safeParse({ ...people, [extra]: true }).success).toBe(false);
    }
  });
});

describe('import row errors', () => {
  it('pass a valid person and organisation', () => {
    expect(
      importRowErrors('person', {
        given_name: 'Ada',
        family_name: 'Lovelace',
        email: 'Ada@Example.org',
        phone: '+44 7700 900982',
      }),
    ).toEqual([]);
    expect(
      importRowErrors('organisation', {
        name: 'Northfield Trust',
        legal_form: 'Registered charity',
        address_line1: '1 High Street',
        town: 'Leeds',
        postcode: 'ls1 1aa',
        identifier_scheme: 'gb-chc',
        identifier: '1234567',
        website: 'https://example.org',
      }),
    ).toEqual([]);
  });

  it('give a field id and a code for each problem, never the value', () => {
    const errors = importRowErrors('organisation', {
      name: '=HYPERLINK("https://example.org","x")',
      legal_form: 'Trust',
      address_line1: '1 High\u202eStreet',
      postcode: 'NOTPC',
      identifier_scheme: 'GB-XX',
      identifier: '1',
      website: 'http://example.org',
    });
    expect(errors).toEqual([
      { field: 'name', code: 'formula' },
      { field: 'town', code: 'required' },
      { field: 'legal_form', code: 'not_in_list' },
      { field: 'identifier_scheme', code: 'not_in_list' },
      { field: 'address_line1', code: 'hidden_characters' },
      { field: 'postcode', code: 'not_valid' },
      { field: 'website', code: 'not_valid' },
    ]);
    expect(JSON.stringify(errors)).not.toMatch(/HYPERLINK|Trust|NOTPC|GB-XX/);
  });

  it("check a long name, an email address and an identifier with party's rules", () => {
    expect(
      importRowErrors('person', { given_name: 'a'.repeat(101), family_name: 'B', email: 'nope' }),
    ).toEqual([
      { field: 'given_name', code: 'too_long' },
      { field: 'email', code: 'not_valid' },
    ]);
    expect(
      importRowErrors('organisation', {
        name: 'N',
        legal_form: 'other',
        address_line1: '1',
        town: 'T',
        postcode: 'LS1 1AA',
        identifier_scheme: 'GB-CHC',
        identifier: 'ABC',
      }),
    ).toEqual([{ field: 'identifier', code: 'not_valid' }]);
  });

  it('have a message for every code, saying how to fix the file', () => {
    for (const message of Object.values(importRowMessages)) expect(message).toMatch(/^[A-Z].*\.$/);
  });
});

describe('formula cells', () => {
  it.each([
    '=1+1',
    '@SUM(A1)',
    '+cmd|"/C calc"!A0',
    '-2+3+cmd|x!A0',
    '\t=1',
    '\r=1',
    '  =1',
    '+A1',
  ])('refuses %j', (value) => {
    expect(isFormulaCell(value)).toBe(true);
  });

  it.each(['Northfield', '+44 7700 900982', '+44 (0)113 496 0000', '-1', '07700-900-982', 'a=b'])(
    'keeps %j',
    (value) => {
      expect(isFormulaCell(value)).toBe(false);
    },
  );
});
