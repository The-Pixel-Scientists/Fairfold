// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { fileRefusalMessages, fileRefusals } from './messages.ts';
import { fileTypeExtensions, fileTypeLabels, fileTypes, MAX_FILE_BYTES } from './types.ts';
import { fileViewSchema, isDownloadable, scanStates } from './view.ts';

const view = {
  id: '0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90',
  name: 'Accounts 2025.pdf',
  type: 'application/pdf',
  bytes: 48_213,
  uploadedAt: '2026-10-09T10:15:00Z',
};

describe('file types', () => {
  it("are ADR 0047's seven, each with words and extensions", () => {
    expect(fileTypes).toHaveLength(7);
    expect(Object.keys(fileTypeLabels)).toEqual([...fileTypes]);
    expect(Object.keys(fileTypeExtensions)).toEqual([...fileTypes]);
    expect(Object.values(fileTypeLabels)).toEqual([
      'PDF',
      'Word document',
      'Excel spreadsheet',
      'OpenDocument text',
      'OpenDocument spreadsheet',
      'JPEG image',
      'PNG image',
    ]);
    for (const extensions of Object.values(fileTypeExtensions)) {
      for (const extension of extensions) expect(extension).toMatch(/^\.[a-z]+$/);
    }
    expect(MAX_FILE_BYTES).toBe(10_485_760);
  });
});

describe('fileViewSchema', () => {
  it('takes a stored file as the console and portal see it', () => {
    expect(fileViewSchema.parse(view)).toEqual(view);
  });

  it('is strict: no storage key, hash, uploader, tenant or scan detail', () => {
    for (const key of ['storageKey', 'sha256', 'createdBy', 'tenantId', 'scanState', 'scannedAt']) {
      expect(fileViewSchema.safeParse({ ...view, [key]: 'x' }).success, key).toBe(false);
    }
  });

  it('refuses a type outside the list and a size outside the limit', () => {
    for (const change of [
      { type: 'image/svg+xml' },
      { type: 'text/html' },
      { bytes: 0 },
      { bytes: MAX_FILE_BYTES + 1 },
      { bytes: 1.5 },
      { uploadedAt: 'yesterday' },
    ]) {
      expect(fileViewSchema.safeParse({ ...view, ...change }).success).toBe(false);
    }
  });
});

describe('scan states', () => {
  it('let only a clean file be downloaded', () => {
    expect(scanStates.filter(isDownloadable)).toEqual(['clean']);
  });
});

describe('refusals', () => {
  it('each say what happened and what to do, in sentences', () => {
    expect(Object.keys(fileRefusalMessages)).toEqual([...fileRefusals]);
    for (const text of Object.values(fileRefusalMessages)) {
      expect(text).toMatch(/^[A-Z][^.]*\.( [A-Z][^.]*[.])+$/);
    }
    expect(fileRefusalMessages.infected).toBe(
      'This file has a virus in it, so it was not uploaded. Check the file and try again.',
    );
    expect(fileRefusalMessages.not_checked).toBe(
      'The file could not be checked. If it has a password, remove it and try again.',
    );
  });
});
