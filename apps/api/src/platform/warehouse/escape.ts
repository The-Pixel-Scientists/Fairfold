// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a value is written into a `COPY ... FROM stdin` block in PostgreSQL's
// text format (ADR 0016). Columns are separated by a tab and rows by a
// newline, `\N` is null, and a line of `\.` ends the data, so a value's
// backslash, tab, newline and carriage return are written as escape
// sequences. With its backslash doubled, a value can never form `\.` or `\N`
// or end a line, and so can never end the block and run as SQL.

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
};

type Value = string | number | boolean | null;

/** The text of one value: `\N` for null, `t` or `f` for a boolean, and escaped text otherwise. */
export function copyValue(value: Value): string {
  if (value === null) return '\\N';
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('A warehouse number is not a whole number.');
    return String(value);
  }
  return value.replace(/[\\\t\n\r]/g, (character) => ESCAPES[character] ?? character);
}

/** One row of a block: its values in column order, separated by tabs, and a newline. */
export const copyRow = (values: readonly Value[]): string =>
  `${values.map(copyValue).join('\t')}\n`;
