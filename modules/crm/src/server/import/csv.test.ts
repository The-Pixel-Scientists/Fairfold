// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { IMPORT_MAX_BYTES, IMPORT_MAX_COLUMNS } from '../../contracts/index.ts';
import { CsvFailure, readCsv } from './csv.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

async function* chunks(...parts: Uint8Array[]) {
  await Promise.resolve();
  yield* parts;
}

const read = (text: string, max = 100) => readCsv(chunks(bytes(text)), max);

async function failure(work: Promise<unknown>) {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(CsvFailure);
    return (error as CsvFailure).code;
  }
  throw new Error('Expected the file to fail.');
}

describe('readCsv', () => {
  it('reads CRLF, LF and CR records, with or without a last line break', async () => {
    expect(await read('a,b\r\nc,d\ne,f\rg,h')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ]);
    expect(await read('a,b\n')).toEqual([['a', 'b']]);
  });

  it('reads quoted fields with commas, doubled quotes and line breaks', async () => {
    expect(await read('"a,1","say ""hi""","x\r\ny"\n"""",""\n')).toEqual([
      ['a,1', 'say "hi"', 'x\r\ny'],
      ['"', ''],
    ]);
  });

  it('keeps empty fields and marks a blank line', async () => {
    expect(await read('a,,c,\n\nd,e,f,\n')).toEqual([
      ['a', '', 'c', ''],
      [''],
      ['d', 'e', 'f', ''],
    ]);
  });

  it('removes a byte order mark and reads a character split across chunks', async () => {
    const text = bytes('﻿name\nZoë\n');
    const cut = text.indexOf(0xc3) + 1;
    expect(await readCsv(chunks(text.slice(0, cut), text.slice(cut)), 10)).toEqual([
      ['name'],
      ['Zoë'],
    ]);
  });

  it.each([
    ['a quote inside an unquoted field', 'a"b,c\n'],
    ['text after a closing quote', '"a"b,c\n'],
    ['a quote that never closes', '"a,b\n'],
  ])('refuses %s as not a CSV file', async (_name, text) => {
    expect(await failure(read(text))).toBe('not_csv');
  });

  it('refuses a file that is not UTF-8', async () => {
    expect(await failure(readCsv(chunks(Uint8Array.of(0x6e, 0xe9, 0x65, 0x0a)), 10))).toBe(
      'not_csv',
    );
    expect(await failure(readCsv(chunks(Uint8Array.of(0x61, 0xc3)), 10))).toBe('not_csv');
  });

  it('stops at the byte cap as the bytes stream in', async () => {
    const big = new Uint8Array(IMPORT_MAX_BYTES + 1).fill(0x61);
    expect(await failure(readCsv(chunks(big), 10))).toBe('too_large');
    expect(await readCsv(chunks(new Uint8Array(IMPORT_MAX_BYTES).fill(0x61)), 10)).toHaveLength(1);
  });

  it('stops at the row cap, counting a header row, and at the column cap', async () => {
    expect(await read('a\nb\nc\n', 3)).toHaveLength(3);
    expect(await failure(read('a\nb\nc\nd\n', 3))).toBe('too_many_rows');
    expect(await failure(read('\n'.repeat(10), 3))).toBe('too_many_rows');
    const wide = (n: number) => Array.from({ length: n }, () => 'x').join(',');
    expect(await read(wide(IMPORT_MAX_COLUMNS))).toHaveLength(1);
    expect(await failure(read(wide(IMPORT_MAX_COLUMNS + 1)))).toBe('too_many_columns');
  });

  it('reports a source that fails as unreadable, without its message', async () => {
    async function* broken(): AsyncGenerator<Uint8Array> {
      await Promise.resolve();
      yield bytes('a\n');
      throw new Error('secret@example.test: storage key clean/abc');
    }
    try {
      await readCsv(broken(), 10);
      expect.unreachable();
    } catch (error) {
      expect((error as CsvFailure).code).toBe('file_unreadable');
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('puts only a fixed code in a failure', async () => {
    try {
      await read('"Quillfeather,Marsh');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toBe('not_csv');
    }
  });
});
