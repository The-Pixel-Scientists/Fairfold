// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A CSV file as a stream of text pieces: RFC 4180 with CRLF line ends, and a
// byte order mark first so Excel reads UTF-8. A row is written as it is
// taken from the source, so no export holds the whole file in memory. Every
// row must be as wide as the heading, so a bug cannot shift a column and put
// one field's value under another's heading.

import { csvCell, type CsvCell } from './cell.ts';

export type CsvRow = readonly CsvCell[];

const BYTE_ORDER_MARK = '\uFEFF';

const line = (row: CsvRow): string => `${row.map(csvCell).join(',')}\r\n`;

export async function* csvChunks(
  heading: CsvRow,
  rows: Iterable<CsvRow> | AsyncIterable<CsvRow>,
): AsyncGenerator<string> {
  yield BYTE_ORDER_MARK + line(heading);
  for await (const row of rows) {
    if (row.length !== heading.length) throw new Error('A CSV row is not as wide as its heading.');
    yield line(row);
  }
}
