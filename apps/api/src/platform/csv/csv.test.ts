// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { csvCell } from './cell.ts';
import { csvChunks, type CsvRow } from './writer.ts';

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of chunks) text += chunk;
  return text;
}

describe('csvCell', () => {
  it.each([
    ['plain text stays as it is', 'Hello', 'Hello'],
    ['null is empty', null, ''],
    ['undefined is empty', undefined, ''],
    ['true is text', true, 'true'],
    ['a number is its digits', 1250.5, '1250.5'],
    ['a comma quotes the cell', 'a,b', '"a,b"'],
    ['a quote is doubled and quoted', 'say "hi"', '"say ""hi"""'],
    ['an LF quotes the cell', 'a\nb', '"a\nb"'],
    ['a CR quotes the cell', 'a\rb', '"a\rb"'],
    ['an equals sign is escaped', '=SUM(A1)', "'=SUM(A1)"],
    ['a plus sign is escaped', '+44 20 7946 0000', "'+44 20 7946 0000"],
    ['a minus sign is escaped', '-2+3', "'-2+3"],
    ['an at sign is escaped', '@cmd', "'@cmd"],
    ['a leading tab is escaped and kept', '\tcmd', "'\tcmd"],
    ['a leading CR is escaped and quoted', '\rcmd', `"'\rcmd"`],
    ['leading spaces do not hide a formula', '  =1+1', "'  =1+1"],
    ['a full-width equals sign is escaped', '＝1+1', "'＝1+1"],
    ['a full-width plus sign is escaped', '＋1', "'＋1"],
    ['a full-width minus sign is escaped', '－1', "'－1"],
    ['a full-width at sign is escaped', '＠x', "'＠x"],
    ['a negative number is written as text', -5, "'-5"],
    ['a formula with a comma is escaped then quoted', '=A1,B1', `"'=A1,B1"`],
    ['an equals sign inside the text is left alone', 'a=b', 'a=b'],
    ['a minus sign after a letter is left alone', 'x-1', 'x-1'],
    ['a leading quote is not a formula', "'=1", "'=1"],
    ['accents and emoji are kept', 'Zoë – café', 'Zoë – café'],
  ])('%s', (_name, cell, expected) => {
    expect(csvCell(cell)).toBe(expected);
  });
});

describe('csvChunks', () => {
  it('writes a byte order mark, then CRLF lines with every heading and cell escaped', async () => {
    const text = await collect(
      csvChunks(
        ['Name', '=Heading', 'Amount'],
        [
          ['Ada, Countess', 'x', 10],
          ['Bo', null, -3],
        ],
      ),
    );

    expect(text).toBe(
      "\uFEFFName,'=Heading,Amount\r\n" + '"Ada, Countess",x,10\r\n' + "Bo,,'-3\r\n",
    );
    expect(Buffer.from(text).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('writes the heading alone for no rows', async () => {
    expect(await collect(csvChunks(['A'], []))).toBe('\uFEFFA\r\n');
  });

  it('takes rows from an async source', async () => {
    async function* rows(): AsyncGenerator<CsvRow> {
      await Promise.resolve();
      yield ['1'];
      yield ['2'];
    }
    expect(await collect(csvChunks(['n'], rows()))).toBe('\uFEFFn\r\n1\r\n2\r\n');
  });

  it('refuses a row that is not as wide as the heading', async () => {
    await expect(collect(csvChunks(['A', 'B'], [['only one']]))).rejects.toThrow(
      'not as wide as its heading',
    );
  });

  it('streams: a row is taken only when the reader asks for it', async () => {
    let taken = 0;
    function* rows(): Generator<CsvRow> {
      for (let n = 0; n < 1_000_000; n += 1) {
        taken += 1;
        yield [`row ${String(n)}`, 'x'.repeat(100)];
      }
    }
    const chunks = csvChunks(['a', 'b'], rows());

    await chunks.next();
    await chunks.next();
    await chunks.next();

    expect(taken).toBeLessThanOrEqual(2);
    await chunks.return(undefined);
  });

  it('writes a large set without keeping it', async () => {
    const total = 50_000;
    function* rows(): Generator<CsvRow> {
      for (let n = 0; n < total; n += 1) yield [n, `=${String(n)}`];
    }
    let count = 0;
    let bytes = 0;
    let longest = 0;
    for await (const chunk of csvChunks(['n', 'text'], rows())) {
      count += 1;
      bytes += Buffer.byteLength(chunk);
      longest = Math.max(longest, chunk.length);
    }

    expect(count).toBe(total + 1);
    expect(longest).toBeLessThan(100);
    expect(bytes).toBeGreaterThan(total * 8);
  });
});
