// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A small CSV reader for the export specs (RFC 4180: quoted cells may hold
// commas, quotes and line breaks), so a cell is read as a spreadsheet would
// read it, and the formula-leading characters the export must neutralise.

/** The characters that start a formula in a spreadsheet, after any leading spaces. */
export const FORMULA_LEADS = ['=', '+', '-', '@', '\t', '\r', '＝', '＋', '－', '＠'];

export const startsAsFormula = (cell: string): boolean => {
  const first = cell.trimStart()[0] ?? '';
  return FORMULA_LEADS.includes(first);
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at] ?? '';
    if (quoted) {
      if (char !== '"') cell += char;
      else if (body[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || (char === '\r' && body[at + 1] === '\n')) {
      if (char === '\r') at += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
}
