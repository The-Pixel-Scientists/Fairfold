// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { copyRow, copyValue } from './escape.ts';

/** What COPY's text format reads back: the escape sequences this module writes. */
function unescape(text: string): string {
  return text.replace(/\\(.)/gs, (_all, character: string) =>
    character === 't' ? '\t' : character === 'n' ? '\n' : character === 'r' ? '\r' : character,
  );
}

describe('copyValue', () => {
  it('writes null, booleans and whole numbers as COPY reads them', () => {
    expect(copyValue(null)).toBe('\\N');
    expect(copyValue(true)).toBe('t');
    expect(copyValue(false)).toBe('f');
    expect(copyValue(-12)).toBe('-12');
    expect(copyValue(100_000_000_000)).toBe('100000000000');
  });

  it('refuses a number that is not a whole number', () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => copyValue(bad)).toThrow(/whole number/);
    }
  });

  it('leaves plain text, quotes and semicolons as they are', () => {
    expect(copyValue("O'Neil; DROP TABLE x; --")).toBe("O'Neil; DROP TABLE x; --");
    expect(copyValue('Zoë 東京')).toBe('Zoë 東京');
  });

  it('escapes the backslash, tab, newline and carriage return', () => {
    expect(copyValue('a\\b')).toBe('a\\\\b');
    expect(copyValue('a\tb')).toBe('a\\tb');
    expect(copyValue('a\nb')).toBe('a\\nb');
    expect(copyValue('a\rb')).toBe('a\\rb');
    expect(copyValue('\r\n')).toBe('\\r\\n');
  });

  it('never writes a bare end-of-data line or a null marker for text', () => {
    expect(copyValue('\\.')).toBe('\\\\.');
    expect(copyValue('\n\\.\n')).toBe('\\n\\\\.\\n');
    expect(copyValue('\\N')).toBe('\\\\N');
  });

  it('reads back as the original text', () => {
    const hostile = ['\\.', '\\N', '\\', '\\\\', '\t', '\n\\.\n', '\r\n', "'; DROP TABLE t; --"];
    for (const value of [...hostile, 'a\\nb', '\\t']) {
      expect(unescape(copyValue(value))).toBe(value);
    }
  });

  it('never contains a raw tab, newline or carriage return, whatever the text', () => {
    const characters = ['\\', '\t', '\n', '\r', '.', 'N', 'x', "'", ';'];
    for (let seed = 0; seed < 500; seed++) {
      const value = Array.from(
        { length: 1 + (seed % 7) },
        (_, index) => characters[(seed * 7 + index * 3 + (seed >> 3)) % characters.length],
      ).join('');
      expect(copyValue(value)).not.toMatch(/[\t\n\r]/);
      expect(unescape(copyValue(value))).toBe(value);
    }
  });
});

describe('copyRow', () => {
  it('joins values with tabs and ends with a newline', () => {
    expect(copyRow(['a', null, 3, true])).toBe('a\t\\N\t3\tt\n');
  });
});
