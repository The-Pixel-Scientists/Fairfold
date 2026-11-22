// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the import screens say about states, failures and fields. A row's
// error is said by its field and code; a cell's value is never in it.

import type { ImportJob } from '../../contracts/index.ts';
import { IMPORT_MAX_BYTES, IMPORT_MAX_COLUMNS, IMPORT_MAX_ROWS } from '../../contracts/index.ts';

export const importFieldWords = {
  name: 'name',
  legal_form: 'legal form',
  address_line1: 'address line 1',
  town: 'town or city',
  postcode: 'postcode',
  address_line2: 'address line 2',
  country_code: 'country',
  website: 'website',
  identifier_scheme: 'identifier register',
  identifier: 'identifier',
  given_name: 'first name',
  family_name: 'last name',
  email: 'email address',
  phone: 'phone number',
} as const;

export const stateWords = {
  queued: 'Waiting to check the file',
  checking: 'Checking the file',
  ready: 'Ready to import',
  failed: 'The file could not be used',
  importing: 'Importing records',
  completed: 'Import finished',
} as const satisfies Record<ImportJob['state'], string>;

const megabytes = IMPORT_MAX_BYTES / (1024 * 1024);

export const failureWords = {
  file_unreadable:
    'The file could not be read. Check that it opens in a spreadsheet, then upload it again.',
  not_csv:
    'The file is not a CSV file. Save it as CSV from your spreadsheet, then upload it again.',
  too_large: `The file is larger than ${String(megabytes)} MB. Split it into smaller files and upload each one.`,
  too_many_rows: `The file has more than ${String(IMPORT_MAX_ROWS)} rows. Split it into smaller files and upload each one.`,
  too_many_columns: `The file has more than ${String(IMPORT_MAX_COLUMNS)} columns. Remove the columns you do not need, then upload it again.`,
  no_rows:
    'The file has no rows to import. Add the records below the header row, then upload it again.',
} as const satisfies Record<NonNullable<ImportJob['failure']>, string>;

export const targetWords = {
  organisation: ['organisation', 'organisations'],
  person: ['person', 'people'],
} as const;

/** "1 organisation" or "120 people". */
export const counted = (target: ImportJob['target'], count: number): string => {
  const [one, many] = targetWords[target];
  return `${String(count)} ${count === 1 ? one : many}`;
};

/** "3 rows" or "1 row". */
export const rowsWords = (count: number): string =>
  `${String(count)} ${count === 1 ? 'row' : 'rows'}`;
