// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One CSV cell as RFC 4180 text, safe to open in a spreadsheet. A cell that
// starts with a character a spreadsheet reads as a formula (after any
// leading spaces) gets a single quote in front, so it shows as text. That is
// the only change to the data: a number that starts with a minus sign is
// written as text for the same reason. A cell with a comma, quote, CR or LF
// is quoted, with each quote doubled.

export type CsvCell = string | number | boolean | null | undefined;

/** `=`, `+`, `-`, `@`, tab and CR, and the full-width forms of the four signs. */
const FORMULA_START = /^ *[=+\-@\t\r＝＋－＠]/u;
const NEEDS_QUOTES = /[",\r\n]/;

export function csvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  const text = String(cell);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
