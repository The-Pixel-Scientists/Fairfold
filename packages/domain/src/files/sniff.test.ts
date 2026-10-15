// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { sniffFileType } from './sniff.ts';
import { fileTypes } from './types.ts';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ODT = 'application/vnd.oasis.opendocument.text';
const ODS = 'application/vnd.oasis.opendocument.spreadsheet';

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
const u16 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number): number[] => [...u16(n & 0xffff), ...u16(n >>> 16)];

interface ZipEntry {
  name: string;
  data?: string;
  /** 0 stored, 8 deflated. Nothing is compressed for real: the check never reads the data. */
  method?: number;
}

/** A ZIP of stored entries, in order, with an optional comment. */
function zip(entries: readonly ZipEntry[], comment = ''): Uint8Array {
  const files: number[] = [];
  const directory: number[] = [];
  for (const { name, data = '', method = 0 } of entries) {
    const offset = files.length;
    const fields = [...u16(method), ...u16(0), ...u16(0), ...u32(0)];
    const sizes = [...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    files.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...fields, ...sizes);
    files.push(...ascii(name), ...ascii(data));
    directory.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...fields, ...sizes);
    directory.push(...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...ascii(name));
  }
  const count = u16(entries.length);
  return new Uint8Array([
    ...files,
    ...directory,
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...count,
    ...count,
    ...u32(directory.length),
    ...u32(files.length),
    ...u16(comment.length),
    ...ascii(comment),
  ]);
}

const ooxml = (...names: string[]): ZipEntry[] => [
  { name: '[Content_Types].xml', data: '<Types/>' },
  { name: '_rels/.rels', data: '<Relationships/>' },
  ...names.map((name) => ({ name, data: '<x/>' })),
];
const odf = (type: string, ...names: string[]): ZipEntry[] => [
  { name: 'mimetype', data: type },
  { name: 'content.xml', data: '<office:document-content/>' },
  { name: 'META-INF/manifest.xml', data: '<manifest:manifest/>' },
  ...names.map((name) => ({ name, data: '<x/>' })),
];

const docx = zip(ooxml('word/document.xml'));

/** Where the end record starts in a ZIP built above without a comment. */
const endOf = (bytes: Uint8Array): number => bytes.length - 22;

/** Where the central directory starts, as the end record says. */
const directoryOf = (bytes: Uint8Array): number =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(endOf(bytes) + 16, true);

function patch(bytes: Uint8Array, at: number, values: readonly number[]): Uint8Array {
  const copy = bytes.slice();
  copy.set(values, at);
  return copy;
}

/** A fixed sequence, so a failure can be reproduced. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state >>> 24;
  };
}

describe('sniffFileType finds each type from its bytes', () => {
  it.each([
    ['a PDF', ascii('%PDF-1.7\n%âãÏÓ\n1 0 obj'), 'application/pdf'],
    ['a JPEG', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF')], 'image/jpeg'],
    ['a PNG', [0x89, ...ascii('PNG\r\n\x1a\n'), 0, 0, 0, 13, ...ascii('IHDR')], 'image/png'],
    ['a Word document', [...docx], DOCX],
    ['an Excel spreadsheet', [...zip(ooxml('xl/workbook.xml', 'xl/worksheets/sheet1.xml'))], XLSX],
    ['an OpenDocument text', [...zip(odf(ODT))], ODT],
    ['an OpenDocument spreadsheet', [...zip(odf(ODS))], ODS],
  ])('%s', (_name, bytes, type) => {
    expect(sniffFileType(new Uint8Array(bytes))).toBe(type);
  });

  it('reads Office part names without regard to case, and a ZIP with a comment', () => {
    expect(sniffFileType(zip(ooxml('Word/Document.XML')))).toBe(DOCX);
    expect(sniffFileType(zip(ooxml('word/document.xml'), 'Made by a test'))).toBe(DOCX);
  });

  it('reads a view into a larger buffer from its own start', () => {
    const buffer = new Uint8Array([0, 0, 0, ...docx]);
    expect(sniffFileType(buffer.subarray(3))).toBe(DOCX);
  });

  it('only ever answers an accepted type or null', () => {
    for (const bytes of [docx, new Uint8Array(0)]) {
      const type = sniffFileType(bytes);
      expect(type === null || fileTypes.includes(type)).toBe(true);
    }
  });
});

describe('sniffFileType refuses', () => {
  it.each([
    ['an empty file', ''],
    ['text', 'Hello'],
    ['HTML renamed as a PDF', '<!doctype html><html><body>%PDF-</body></html>'],
    ['an SVG', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['a PDF signature not at the start', ' %PDF-1.7'],
    ['a GIF', 'GIF89a'],
    ['a WebP', 'RIFF\0\0\0\0WEBPVP8 '],
    ['a Windows program', 'MZ\x90\0\x03\0\0\0'],
    ['an old Word document', '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'],
  ])('%s', (_name, text) => {
    expect(sniffFileType(new Uint8Array(ascii(text)))).toBeNull();
  });

  it('a ZIP without the right entries', () => {
    for (const entries of [
      [{ name: 'readme.txt', data: 'hi' }],
      [{ name: 'word/document.xml' }],
      ooxml(),
      ooxml('word/document.xml', 'xl/workbook.xml'),
      ooxml('ppt/presentation.xml'),
    ]) {
      expect(sniffFileType(zip(entries)), JSON.stringify(entries)).toBeNull();
    }
  });

  it('documents with macros', () => {
    for (const entries of [
      ooxml('word/document.xml', 'word/vbaProject.bin'),
      ooxml('xl/workbook.xml', 'xl/VBAPROJECT.BIN'),
      ooxml('word/document.xml', '/word/vbaProject.bin'),
      ooxml('word/document.xml', 'word\\vbaProject.bin'),
      ooxml('xl/workbook.xml', 'xl/macrosheets/sheet1.xml'),
      odf(ODT, 'Basic/Standard/Module1.xml'),
      odf(ODS, 'Scripts/python/macro.py'),
    ]) {
      expect(sniffFileType(zip(entries)), JSON.stringify(entries)).toBeNull();
    }
  });

  it('macros by entry name only, leaving a renamed VBA project to clamd', () => {
    expect(sniffFileType(zip(ooxml('word/document.xml', 'word/media/image9.bin')))).toBe(DOCX);
  });

  it('an OpenDocument file without the right first entry', () => {
    const odt = zip(odf(ODT));
    const second = 30 + 'mimetype'.length + ODT.length;
    expect(sniffFileType(patch(odt, directoryOf(odt) + 42, u32(second)))).toBeNull();
    expect(sniffFileType(patch(odt, 18, u32(ODT.length - 1)))).toBeNull();
    const [mimetype, ...rest] = odf(ODT) as [ZipEntry, ...ZipEntry[]];
    for (const entries of [
      [...rest, mimetype],
      [{ ...mimetype, method: 8 }, ...rest],
      [{ ...mimetype, data: `${ODT} ` }, ...rest],
      [{ ...mimetype, data: 'application/vnd.oasis.opendocument.presentation' }, ...rest],
      [{ ...mimetype, name: 'MimeType' }, ...rest],
      [...odf(ODT), { name: '[Content_Types].xml' }, { name: 'word/document.xml' }],
    ]) {
      expect(sniffFileType(zip(entries)), JSON.stringify(entries)).toBeNull();
    }
  });

  it('every truncated copy of a document', () => {
    for (let length = 0; length < docx.length; length++) {
      expect(sniffFileType(docx.subarray(0, length)), String(length)).toBeNull();
    }
  });

  it('bytes before the ZIP, or after its end record', () => {
    expect(sniffFileType(new Uint8Array([0, ...docx]))).toBeNull();
    expect(sniffFileType(new Uint8Array([...docx, 0]))).toBeNull();
  });
});

describe('sniffFileType reads a ZIP within bounds', () => {
  const end = endOf(docx);
  const directory = directoryOf(docx);

  it('finds the end record only in the last 65,557 bytes', () => {
    const longest = zip(ooxml('word/document.xml'), 'x'.repeat(0xffff));
    expect(sniffFileType(longest)).toBe(DOCX);
    // A comment cannot be longer, so a record further back never ends the file.
    expect(sniffFileType(new Uint8Array([...longest, 0]))).toBeNull();
  });

  it('reads at most 10,000 entries', () => {
    const names = Array.from({ length: 9_997 }, (_, i) => `word/media/${String(i)}.xml`);
    expect(sniffFileType(zip(ooxml('word/document.xml', ...names)))).toBe(DOCX);
    expect(sniffFileType(zip(ooxml('word/document.xml', 'extra.xml', ...names)))).toBeNull();
  });

  it('refuses split archives and ZIP64', () => {
    for (const [at, values] of [
      [end + 4, u16(1)], // this disk
      [end + 6, u16(1)], // the directory's disk
      [end + 8, u16(2)], // entries on this disk
      [directory + 34, u16(1)], // an entry's disk
      [directory + 20, u32(0xffffffff)], // an entry's compressed size
      [directory + 24, u32(0xffffffff)], // an entry's size
      [directory + 42, u32(0xffffffff)], // an entry's offset
      [end + 10, u16(0xffff)], // entries in all
    ] as const) {
      expect(sniffFileType(patch(docx, at, values)), String(at)).toBeNull();
    }
    // A ZIP64 locator between the directory and the end record, counted in the directory's size.
    const locator = [...u32(0x07064b50), ...u32(0), ...u32(0), ...u32(0), ...u32(1)];
    const withLocator = new Uint8Array([
      ...docx.subarray(0, end),
      ...locator,
      ...docx.subarray(end),
    ]);
    expect(sniffFileType(patch(withLocator, end + 20 + 12, u32(end - directory + 20)))).toBeNull();
  });

  it('refuses a directory that disagrees with its end record', () => {
    const longer = zip(ooxml('word/document.xml', 'docProps/app.xml'));
    expect(sniffFileType(longer)).toBe(DOCX);
    expect(sniffFileType(patch(longer, endOf(longer) + 8, [...u16(3), ...u16(3)]))).toBeNull();
    for (const [at, values] of [
      [end + 10, u16(2)], // fewer entries than listed
      [end + 10, u16(4)], // more entries than listed
      [end + 12, u32(end - directory - 1)], // a shorter directory
      [end + 12, u32(end - directory + 1)], // a longer one
      [end + 16, u32(directory - 1)], // an earlier start
      [end + 16, u32(directory + 46)], // a start inside the directory
      [directory, u32(0x04034b50)], // an entry that is not a central header
      [directory + 28, u16(0xffff)], // a name that runs past the end record
      [directory + 30, u16(46)], // extra data that overlaps the next entry
    ] as const) {
      expect(sniffFileType(patch(docx, at, values)), String(at)).toBeNull();
    }
  });

  it('refuses entries that point outside the buffer or into the directory', () => {
    for (const [at, values] of [
      [directory + 42, u32(directory)],
      [directory + 42, u32(docx.length)],
      [directory + 20, u32(directory)],
    ] as const) {
      expect(sniffFileType(patch(docx, at, values)), String(at)).toBeNull();
    }
  });

  it('never throws on random or damaged bytes', () => {
    const next = random(47);
    for (let round = 0; round < 500; round++) {
      const noise = Array.from({ length: next() * 4 }, next);
      const zipLike = new Uint8Array([...u32(0x04034b50), ...noise, ...u32(0x06054b50), ...noise]);
      const damaged = patch(docx, next() % docx.length, [next(), next()]);
      for (const bytes of [new Uint8Array(noise), zipLike, damaged]) {
        const type = sniffFileType(bytes);
        expect(type === null || fileTypes.includes(type)).toBe(true);
      }
    }
  });
});
