// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messageForIssue } from '../platform/messages.ts';
import { fileNameMessages } from './messages.ts';
import {
  decodeFileNameHeader,
  encodeFileNameHeader,
  fileNameMatchesType,
  fileNameSchema,
} from './name.ts';

const message = (name: string): string | undefined => {
  const result = fileNameSchema.safeParse(name);
  return result.success ? undefined : messageForIssue(result.error.issues[0] ?? {});
};

describe('fileNameSchema', () => {
  it('takes a name of 1 to 200 characters, trimmed', () => {
    expect(fileNameSchema.parse('  Accounts 2025–26.pdf ')).toBe('Accounts 2025–26.pdf');
    expect(fileNameSchema.parse('Café plan (draft) #2.docx')).toBe('Café plan (draft) #2.docx');
    expect(fileNameSchema.parse('🌱'.repeat(200))).toBe('🌱'.repeat(200));
    expect(message('')).toBe(fileNameMessages.length);
    expect(message('   ')).toBe(fileNameMessages.length);
    expect(message('a'.repeat(201))).toBe(fileNameMessages.length);
    expect(message('🌱'.repeat(201))).toBe(fileNameMessages.length);
  });

  it('refuses, never strips, hidden characters and path separators', () => {
    for (const name of [
      'a/b.pdf',
      '..\\b.pdf',
      'tab\there.pdf',
      'line\nbreak.pdf',
      'nul\0.pdf',
      'del\x7f.pdf',
      'invoice\u202Efdp.exe',
      'zero\u200Bwidth.pdf',
      '\uFEFFbom.pdf',
      'line\u2028separator.pdf',
      'paragraph\u2029separator.pdf',
      'lone\uD800surrogate.pdf',
      '\u2028',
    ]) {
      expect(message(name), JSON.stringify(name)).toBe(fileNameMessages.characters);
    }
  });
});

describe('fileNameMatchesType', () => {
  const PDF = 'application/pdf';
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  it("takes a name ending with one of the type's extensions, in any case", () => {
    for (const [name, type] of [
      ['Accounts.pdf', PDF],
      ['ACCOUNTS.PDF', PDF],
      ['Budget.hta.pdf', PDF],
      ['.pdf', PDF],
      ['Plan.Docx', DOCX],
      ['photo.jpg', 'image/jpeg'],
      ['photo.JPEG', 'image/jpeg'],
      ['Sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['Notes.odt', 'application/vnd.oasis.opendocument.text'],
      ['Sums.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
      ['logo.png', 'image/png'],
    ] as const) {
      expect(fileNameMatchesType(name, type), name).toBe(true);
    }
  });

  it('refuses a name that would open as another type', () => {
    for (const [name, type] of [
      ['Budget.hta', PDF],
      ['a.bat', PDF],
      ['x.html', PDF],
      ['Budget.pdf.hta', PDF],
      ['Budget.pdf.', PDF],
      ['Budget', PDF],
      ['Budgetpdf', PDF],
      ['budget.docm', DOCX],
      ['budget.dotx', DOCX],
      ['report.pdf', DOCX],
      ['photo.png', 'image/jpeg'],
      ['photo.jpg', 'image/png'],
    ] as const) {
      expect(fileNameMatchesType(name, type), name).toBe(false);
    }
  });
});

describe('the File-Name header', () => {
  it('round-trips any accepted name as percent-encoded UTF-8', () => {
    for (const name of [
      'Accounts.pdf',
      'Café plan (draft) #2.docx',
      '预算 ✓ 🌱.xlsx',
      "O'Neil & co.png",
    ]) {
      const header = encodeFileNameHeader(name);
      expect(header).toMatch(/^[\x21-\x7e]+$/);
      expect(decodeFileNameHeader(header)).toBe(name);
    }
    expect(encodeFileNameHeader('é 1.pdf')).toBe('%C3%A9%201.pdf');
  });

  it('refuses a missing value, raw characters and invalid UTF-8', () => {
    for (const header of [
      undefined,
      '',
      'a b.pdf',
      'café.pdf',
      '%',
      '%E',
      '%ZZ.pdf',
      '%C3', // a lead byte alone
      '%C3%28', // a bad continuation byte
      '%C0%AF', // an overlong slash
      '%ED%A0%80', // an encoded surrogate
      '%F4%90%80%80', // past U+10FFFF
      '%FF',
    ]) {
      expect(decodeFileNameHeader(header), String(header)).toBeNull();
    }
  });

  it('refuses what fileNameSchema refuses, and anything too long to be a name', () => {
    for (const name of ['a/b.pdf', '..%5Cb.pdf', 'a%00.pdf', 'a%E2%80%AE.pdf', '%20%20']) {
      expect(decodeFileNameHeader(name), name).toBeNull();
    }
    expect(decodeFileNameHeader('%2F')).toBeNull();
    expect(decodeFileNameHeader(encodeFileNameHeader('🌱'.repeat(200)))).toBe('🌱'.repeat(200));
    expect(decodeFileNameHeader('a'.repeat(2401))).toBeNull();
  });

  it('trims what it decodes', () => {
    expect(decodeFileNameHeader('%20Accounts.pdf%20')).toBe('Accounts.pdf');
  });
});
