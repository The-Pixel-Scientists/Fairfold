// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { readCsv } from './csv.ts';

const rows = (text: string) => {
  const read = readCsv(text, 10);
  if (read.kind !== 'rows') throw new Error(read.kind);
  return read.rows;
};

describe('readCsv', () => {
  it('reads plain rows, numbering them from the header', () => {
    expect(rows('a,b\n1,2\n')).toEqual([
      { row: 1, cells: ['a', 'b'] },
      { row: 2, cells: ['1', '2'] },
    ]);
  });

  it('reads quoted commas, quoted line breaks and doubled quotes as one value', () => {
    expect(rows('a,b\n"x, y","line one\nline two"\n"say ""hi""",z')).toEqual([
      { row: 1, cells: ['a', 'b'] },
      { row: 2, cells: ['x, y', 'line one\nline two'] },
      { row: 3, cells: ['say "hi"', 'z'] },
    ]);
  });

  it('drops a byte order mark and reads CRLF and CR line endings', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(rows(`${bom}a,b\r\n1,2\r3,4`)).toEqual([
      { row: 1, cells: ['a', 'b'] },
      { row: 2, cells: ['1', '2'] },
      { row: 3, cells: ['3', '4'] },
    ]);
  });

  it('trims values and skips blank rows, keeping the spreadsheet row numbers', () => {
    expect(rows('a , b\n\n,\n 1 , "2 "\n')).toEqual([
      { row: 1, cells: ['a', 'b'] },
      { row: 4, cells: ['1', '2'] },
    ]);
  });

  it('keeps an empty last value', () => {
    expect(rows('a,b\n1,')).toEqual([
      { row: 1, cells: ['a', 'b'] },
      { row: 2, cells: ['1', ''] },
    ]);
  });

  it('names the row of a quote that is never closed', () => {
    expect(readCsv('a,b\n1,"2\n3,4\n', 10)).toEqual({ kind: 'unclosedQuote', row: 2 });
  });

  it('stops past the row limit', () => {
    expect(readCsv('a\n1\n2\n', 3)).toMatchObject({ kind: 'rows' });
    expect(readCsv('a\n1\n2\n3\n4\n5\n', 3)).toEqual({ kind: 'tooManyRows' });
    expect(readCsv('a\n1\n2\n3', 3)).toEqual({ kind: 'tooManyRows' });
  });
});
