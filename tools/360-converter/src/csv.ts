// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A CSV reader for RFC 4180 files as spreadsheets save them: commas between
// values, double quotes round a value holding a comma, quote or line break, a
// doubled quote for a quote inside one, CRLF, LF or CR line endings, and an
// optional byte order mark. Values are trimmed. Rows whose values are all
// blank are skipped, but still counted, so row numbers match the spreadsheet.

export interface CsvRow {
  /** The row's number in the spreadsheet: the header is row 1. */
  readonly row: number;
  readonly cells: readonly string[];
}

export type CsvResult =
  | { readonly kind: 'rows'; readonly rows: readonly CsvRow[] }
  | { readonly kind: 'unclosedQuote'; readonly row: number }
  | { readonly kind: 'tooManyRows' };

const BYTE_ORDER_MARK = 0xfeff;

/** Reads `text`, stopping once it holds more than `limit` rows that are not blank. */
export function readCsv(text: string, limit: number): CsvResult {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let value = '';
  let quoted = false;
  let row = 1;

  const endValue = () => {
    cells.push(value.trim());
    value = '';
  };
  const endRow = () => {
    endValue();
    if (cells.some((cell) => cell !== '')) rows.push({ row, cells });
    cells = [];
    row++;
  };

  for (let at = text.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0; at < text.length; at++) {
    const char = text.charAt(at);
    if (quoted) {
      if (char !== '"') {
        value += char;
      } else if (text.charAt(at + 1) === '"') {
        value += '"';
        at++;
      } else {
        quoted = false;
      }
    } else if (char === '"' && value.trim() === '') {
      quoted = true;
      value = '';
    } else if (char === ',') {
      endValue();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text.charAt(at + 1) === '\n') at++;
      endRow();
      if (rows.length > limit) return { kind: 'tooManyRows' };
    } else {
      value += char;
    }
  }
  if (quoted) return { kind: 'unclosedQuote', row };
  if (value !== '' || cells.length > 0) endRow();
  return rows.length > limit ? { kind: 'tooManyRows' } : { kind: 'rows', rows };
}
