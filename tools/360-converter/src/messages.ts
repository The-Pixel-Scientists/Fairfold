// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the converter says, in the words of docs/CONTENT-STYLE.md. No message
// repeats a value from a grant's row: a problem is named by its row number and
// column only.

import { currencies } from '@pixel-scientists/domain/platform';
import { identifierSchemeIds } from '@pixel-scientists/party/contracts';

const list = (items: readonly string[]) =>
  new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(items);

const organisationsOnly = '360Giving files from this tool cover grants to organisations only.';

/** What to enter in each column, after "Row 12, Amount: ". */
export const columnMessages = {
  'Grant reference':
    'Enter a reference with no spaces, like NF-2027-001. With the prefix, it can be up to 200 characters.',
  Title: 'Enter a title of up to 120 characters.',
  Description: 'Enter a description of up to 300 characters.',
  Amount:
    'Enter the amount awarded in pounds, more than zero, like 2500 or 2500.50, with no £ sign or commas.',
  Currency: `Enter the currency code ${list(currencies)}.`,
  'Award date': 'Enter the date of the award as year, month and day, like 2027-05-14.',
  'Recipient organisation name': "Enter the organisation's name, up to 200 characters.",
  'Recipient identifier': "Enter the organisation's number as its register writes it.",
  'Recipient scheme': `Enter the register the number is from: ${list(identifierSchemeIds)}.`,
  'Programme title': 'Enter a programme title of up to 120 characters.',
} as const;

export type Column = keyof typeof columnMessages;

export const converterMessages = {
  emptyFile:
    'The file is empty. Add the header row from template.csv, then one row for each grant.',
  noGrants: 'The file has no grants. Add one row for each grant under the header row.',
  tooManyRows: (limit: number) =>
    `The file has more than ${limit.toLocaleString('en-GB')} grants. Split it into files of ${limit.toLocaleString('en-GB')} rows or fewer and convert each one.`,
  unclosedQuote: (row: number) =>
    `Row ${row} has a quote mark that is not closed. Close the quoted value with a second quote mark.`,
  unknownColumn: (column: number, name: string) =>
    `Column ${column}, "${name}", is not in the template. Remove it, or rename it to match template.csv.`,
  individualColumn: (column: number) =>
    `Column ${column} is for individual recipients. ${organisationsOnly} Remove the column.`,
  missingColumn: (name: Column) => `The file has no "${name}" column. Add it as in template.csv.`,
  repeatedColumn: (name: Column) => `The file has more than one "${name}" column. Keep one.`,
  extraValues: (row: number) =>
    `Row ${row} has more values than the header row has columns. Remove the extra values, or put quote marks round any value that holds a comma.`,
  noOrganisation: (row: number) =>
    `Row ${row} has no recipient organisation. ${organisationsOnly} Remove the row or add the organisation's name and charity or company number.`,
  repeatedReference: (row: number, first: number) =>
    `Row ${row}, Grant reference: row ${first} has the same reference. Give each grant its own reference.`,
  cell: (row: number, column: Column, message: string) => `Row ${row}, ${column}: ${message}`,
  option: (label: string, message: string) => `${label}: ${message}`,
} as const;
