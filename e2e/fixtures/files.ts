// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Synthetic files for the journey, made when a test asks for them and held
// only in memory: a small PDF, a small spreadsheet, a file too big for a
// question, and the antivirus test string. The test string is built from two
// halves and never written to disk, where antivirus software would
// quarantine the file. None holds personal data.

import { crc32 } from 'node:zlib';

/** A small PDF with one blank page. */
export function accountsPdf(): Buffer {
  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj',
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
      'trailer<</Root 1 0 R>>',
      '%%EOF',
    ].join('\n'),
  );
}

/** A PDF that is `bytes` long, for a limit. */
export function pdfOfSize(bytes: number): Buffer {
  const head = accountsPdf();
  return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 0x20)]);
}

/**
 * The antivirus test string inside a PDF, as a stream object: ClamAV matches
 * it only as a whole file or as an object, and the type check needs the PDF
 * header, so the scanner and not the type check refuses the file.
 */
export function virusPdf(): Buffer {
  const eicar = [
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$',
    'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!',
    '$H+H*',
  ].join('');
  return Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj',
      '<< /Type /Catalog >>',
      'endobj',
      '2 0 obj',
      `<< /Length ${String(eicar.length)} >>`,
      'stream',
      eicar,
      'endstream',
      'endobj',
      'trailer',
      '<< /Root 1 0 R >>',
      '%%EOF',
      '',
    ].join('\n'),
  );
}

const u16 = (value: number): Buffer => Buffer.from([value & 0xff, value >> 8]);
const u32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};

/** A ZIP of stored entries, as much as the type check reads: local headers, a central directory, an end record. */
function zip(entries: readonly (readonly [name: string, text: string])[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    // Version, flags, method, time and date, then the checksum and both sizes.
    const sizes = [u32(crc32(data)), u32(data.length), u32(data.length)];
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      ...[u16(0), u16(0), u16(0), u16(0)],
      ...sizes,
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        ...[u16(0), u16(0), u16(0), u16(0)],
        ...sizes,
        u16(nameBytes.length),
        // Extra field, comment, disk, internal and external attributes, then where the entry starts.
        ...[u16(0), u16(0), u16(0), u16(0), u32(0)],
        u32(offset),
        nameBytes,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    directory,
    u32(0x06054b50),
    ...[u16(0), u16(0), u16(entries.length), u16(entries.length)],
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
}

/** A small Excel spreadsheet: the entries the type check looks for, and one sheet. */
export function budgetSpreadsheet(): Buffer {
  return zip([
    [
      '[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ],
    [
      'xl/workbook.xml',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
    ],
  ]);
}
