// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a file is, from its own bytes (ADR 0047). The bytes, the name and
// the type a browser declares are all claims: the server checks the type
// with sniffFileType() and stores a file only as the type found, while the
// browser runs it only to warn early. This check is the boundary for what
// is stored, so it stays small:
//   - PDF, JPEG and PNG by their first bytes;
//   - Word and Excel by the entry names in a ZIP's central directory;
//   - OpenDocument by a ZIP's first entry, an uncompressed `mimetype`.
// It never decompresses anything, reads a bounded part of any input, and
// refuses (never throws on) whatever it cannot read. Because it reads only
// those bytes and names, it says nothing about the rest of a file: clamd
// scans the content, including for VBA macros under any part name, and
// fileNameMatchesType() ties the file's name to the type found here.

import type { FileType } from './types.ts';

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// ZIP record signatures, read little-endian.
const LOCAL_HEADER = 0x04034b50; // PK 03 04
const CENTRAL_HEADER = 0x02014b50; // PK 01 02
const END_RECORD = 0x06054b50; // PK 05 06

const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const END_SIZE = 22;
/** The end record's comment is at most 65,535 bytes, so the record starts in the last 65,557. */
const END_SEARCH = END_SIZE + 0xffff;
const MAX_ZIP_ENTRIES = 10_000;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ODT = 'application/vnd.oasis.opendocument.text';
const ODS = 'application/vnd.oasis.opendocument.spreadsheet';

interface Entry {
  /** Lower case, with `/` for `\` and no leading `/`: Office reads part names without regard to case. */
  name: string;
  localOffset: number;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let text = '';
  for (const byte of bytes.subarray(start, end)) text += String.fromCharCode(byte);
  return text;
}

/** Where the end record starts: the last signature whose comment ends the file exactly. */
function findEnd(bytes: Uint8Array, view: DataView): number | null {
  for (let at = bytes.length - END_SIZE; at >= Math.max(0, bytes.length - END_SEARCH); at--) {
    // End record: 0 signature, 20 comment length, 22 comment.
    if (
      view.getUint32(at, true) === END_RECORD &&
      at + END_SIZE + view.getUint16(at + 20, true) === bytes.length
    ) {
      return at;
    }
  }
  return null;
}

/** The central directory's entries, or null if it is split, ZIP64, too long or disagrees with itself. */
function readDirectory(bytes: Uint8Array, view: DataView): Entry[] | null {
  const end = findEnd(bytes, view);
  if (end === null) return null;
  // End record: 4 this disk, 6 the directory's disk, 8 entries on this disk,
  // 10 entries in all, 12 directory size, 16 directory offset.
  const total = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  const split =
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== total;
  // The directory must run exactly up to the end record. That refuses ZIP64,
  // whose own records sit between the two, as do the count limit and the
  // 0xFFFFFFFF checks below on the fields ZIP64 marks.
  if (split || total === 0 || total > MAX_ZIP_ENTRIES || start + size !== end) return null;

  const entries: Entry[] = [];
  let at = start;
  for (let i = 0; i < total; i++) {
    if (at + CENTRAL_SIZE > end || view.getUint32(at, true) !== CENTRAL_HEADER) return null;
    // Central header: 20 compressed size, 24 size, 28 name length, 30 extra
    // length, 32 comment length, 34 disk, 42 local header offset, 46 name.
    const compressed = view.getUint32(at + 20, true);
    const uncompressed = view.getUint32(at + 24, true);
    const nameEnd = at + CENTRAL_SIZE + view.getUint16(at + 28, true);
    const next = nameEnd + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (
      next > end ||
      view.getUint16(at + 34, true) !== 0 ||
      [compressed, uncompressed, localOffset].includes(0xffffffff) ||
      localOffset + LOCAL_SIZE + compressed > start
    ) {
      return null;
    }
    const name = latin1(bytes, at + CENTRAL_SIZE, nameEnd)
      .toLowerCase()
      .replaceAll('\\', '/');
    entries.push({ name: name.replace(/^\/+/, ''), localOffset });
    at = next;
  }
  return at === end ? entries : null;
}

/**
 * An entry named as macros usually are: a VBA project or Excel 4.0 macro
 * sheets in Office, Basic or scripts in OpenDocument. A fast first pass by
 * name only: Office finds a VBA project through a relationship, so the part
 * can have any name, and only clamd's macro alert finds one named otherwise.
 */
function isMacro(name: string): boolean {
  return (
    name.endsWith('vbaproject.bin') ||
    name.startsWith('xl/macrosheets/') ||
    name.startsWith('basic/') ||
    name.startsWith('scripts/')
  );
}

/** The type an OpenDocument file names in its first entry, stored uncompressed at offset 0. */
function openDocumentType(bytes: Uint8Array, view: DataView): FileType | null {
  // Local header: 8 method (0 is stored), 18 compressed size, 22 size,
  // 26 name length, 28 extra length, 30 name, then extra, then the data.
  const size = view.getUint32(22, true);
  const nameLength = view.getUint16(26, true);
  const data = LOCAL_SIZE + nameLength + view.getUint16(28, true);
  if (
    view.getUint16(8, true) !== 0 ||
    view.getUint32(18, true) !== size ||
    latin1(bytes, LOCAL_SIZE, LOCAL_SIZE + nameLength) !== 'mimetype' ||
    size > ODS.length ||
    data + size > bytes.length
  ) {
    return null;
  }
  const type = latin1(bytes, data, data + size);
  return type === ODT || type === ODS ? type : null;
}

function sniffZip(bytes: Uint8Array): FileType | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== LOCAL_HEADER) return null;
  const entries = readDirectory(bytes, view);
  if (entries === null || entries.some(({ name }) => isMacro(name))) return null;
  const names = new Set(entries.map(({ name }) => name));
  const contentTypes = names.has('[content_types].xml');
  if (entries[0]?.name === 'mimetype' && entries[0].localOffset === 0) {
    return contentTypes ? null : openDocumentType(bytes, view);
  }
  const word = names.has('word/document.xml');
  const excel = names.has('xl/workbook.xml');
  if (!contentTypes || word === excel) return null;
  return word ? DOCX : XLSX;
}

/** The accepted type these bytes are, or null for anything else. Pure, and never throws. */
export function sniffFileType(bytes: Uint8Array): FileType | null {
  if (startsWith(bytes, PDF)) return 'application/pdf';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, PNG)) return 'image/png';
  if (bytes.length < LOCAL_SIZE + END_SIZE) return null;
  try {
    return sniffZip(bytes);
  } catch {
    // Every read above is bounded, but a read past the end must refuse, never throw.
    return null;
  }
}
