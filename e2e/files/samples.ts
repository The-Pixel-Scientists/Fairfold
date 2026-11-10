// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Synthetic files that the type check passes and the scanner or the content
// check must refuse. Built in memory when a test asks; nothing is written to
// disk, where antivirus software would quarantine it. None holds personal data.

import { crc32 } from 'node:zlib';

const u16 = (value: number): Buffer => Buffer.from([value & 0xff, value >> 8]);
const u32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};

/**
 * A Word document whose entries are flagged as encrypted (bit 0 of the ZIP
 * flags). The type check reads only entry names, so it passes; clamd, run with
 * `AlertEncrypted`, must refuse it because it cannot look inside.
 */
export function encryptedDocument(): Buffer {
  const entries: (readonly [string, string])[] = [
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml', '<document/>'],
  ];
  const ENCRYPTED = 1;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const sizes = [u32(crc32(data)), u32(data.length), u32(data.length)];
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(ENCRYPTED),
      ...[u16(0), u16(0), u16(0)],
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
        u16(ENCRYPTED),
        ...[u16(0), u16(0), u16(0)],
        ...sizes,
        u16(nameBytes.length),
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

/** A web page that a name ending in `.pdf` and a PDF type claim to be a PDF. */
export function pageNamedAsPdf(): Buffer {
  return Buffer.from('<!doctype html><title>Fernhill budget</title><p>Not a PDF.</p>');
}
