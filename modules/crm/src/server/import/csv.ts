// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A small RFC 4180 reader for an uploaded import (ADR 0025): quoted fields
// with commas, doubled quotes and line breaks inside, CRLF, LF or CR between
// records, UTF-8 with or without a byte order mark. The caps are checked as
// the bytes stream in, so a file over them is never held whole. A failure is
// one of the contract's fixed codes and carries no cell, header or file name.

import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_COLUMNS,
  type importFailures,
} from '../../contracts/index.ts';

export type ImportFailure = (typeof importFailures)[number];

export class CsvFailure extends Error {
  override name = 'CsvFailure';
  readonly code: ImportFailure;

  constructor(code: ImportFailure) {
    super(code);
    this.code = code;
  }
}

class Records {
  readonly rows: string[][] = [];
  private record: string[] = [];
  private field = '';
  private quoted = false;
  private closed = false;
  private skipLineFeed = false;

  private readonly maxRecords: number;

  constructor(maxRecords: number) {
    this.maxRecords = maxRecords;
  }

  write(text: string): void {
    for (const char of text) this.take(char);
  }

  finish(): string[][] {
    if (this.quoted) throw new CsvFailure('not_csv');
    if (this.field !== '' || this.record.length > 0 || this.closed) this.endRecord();
    return this.rows;
  }

  private take(char: string): void {
    if (this.quoted) {
      if (char === '"') {
        this.quoted = false;
        this.closed = true;
      } else this.field += char;
      return;
    }
    if (this.skipLineFeed) {
      this.skipLineFeed = false;
      if (char === '\n') return;
    }
    if (this.closed && char === '"') {
      this.quoted = true;
      this.closed = false;
      this.field += '"';
    } else if (this.closed && char !== ',' && char !== '\n' && char !== '\r') {
      throw new CsvFailure('not_csv');
    } else if (char === ',') this.endField();
    else if (char === '\n' || char === '\r') {
      this.endRecord();
      this.skipLineFeed = char === '\r';
    } else if (char === '"') {
      if (this.field !== '') throw new CsvFailure('not_csv');
      this.quoted = true;
    } else this.field += char;
  }

  private endField(): void {
    this.record.push(this.field);
    if (this.record.length > IMPORT_MAX_COLUMNS) throw new CsvFailure('too_many_columns');
    this.field = '';
    this.closed = false;
  }

  private endRecord(): void {
    this.endField();
    this.rows.push(this.record);
    if (this.rows.length > this.maxRecords) throw new CsvFailure('too_many_rows');
    this.record = [];
  }
}

/**
 * Every record of the file, a blank line as `['']`. `maxRecords` counts a
 * header row. A source that fails to read is `file_unreadable`.
 */
export async function readCsv(
  source: AsyncIterable<Uint8Array>,
  maxRecords: number,
): Promise<string[][]> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const records = new Records(maxRecords);
  let bytes = 0;
  const decode = (chunk?: Uint8Array): string => {
    try {
      return chunk === undefined ? decoder.decode() : decoder.decode(chunk, { stream: true });
    } catch {
      throw new CsvFailure('not_csv');
    }
  };
  try {
    for await (const chunk of source) {
      bytes += chunk.byteLength;
      if (bytes > IMPORT_MAX_BYTES) throw new CsvFailure('too_large');
      records.write(decode(chunk));
    }
    records.write(decode());
    return records.finish();
  } catch (error) {
    throw error instanceof CsvFailure ? error : new CsvFailure('file_unreadable');
  }
}
