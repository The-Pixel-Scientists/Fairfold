// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { fileSize, typesInWords } from './files.tsx';

const MB = 1024 * 1024;

describe('fileSize', () => {
  it('says a size in the unit people read, with a tenth below 10', () => {
    expect(fileSize(0)).toBe('0 B');
    expect(fileSize(500)).toBe('500 B');
    expect(fileSize(834 * 1024)).toBe('834 KB');
    expect(fileSize(1_258_291)).toBe('1.2 MB');
    expect(fileSize(2_202_010)).toBe('2.1 MB');
    expect(fileSize(10 * MB)).toBe('10 MB');
    expect(fileSize(12.4 * MB)).toBe('12 MB');
    expect(fileSize(3 * 1024 * MB)).toBe('3 GB');
  });

  it('rounds to the nearest by default, and as the caller says for a limit', () => {
    expect(fileSize(5.58 * MB)).toBe('5.6 MB');
    expect(fileSize(5.58 * MB, Math.floor)).toBe('5.5 MB');
  });
});

describe('typesInWords', () => {
  const labels = { a: 'PDF', b: 'Word document', c: 'Excel spreadsheet' };

  it('names the types with "or" before the last', () => {
    expect(typesInWords(['a'], labels)).toBe('PDF');
    expect(typesInWords(['a', 'b'], labels)).toBe('PDF or Word document');
    expect(typesInWords(['a', 'b', 'c'], labels)).toBe('PDF, Word document or Excel spreadsheet');
  });

  it('shows a type with no label as itself', () => {
    expect(typesInWords(['a', 'x'], labels)).toBe('PDF or x');
    expect(typesInWords(['a'], undefined)).toBe('a');
  });
});
