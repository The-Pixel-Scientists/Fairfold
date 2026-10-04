// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { countCharacters, countWords } from './words.ts';

describe('countWords', () => {
  it('counts words between spaces and line breaks', () => {
    expect(countWords('A new roof for the hall')).toBe(6);
    expect(countWords('  two\n\nwords  ')).toBe(2);
    expect(countWords('one\ttwo\r\nthree')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
  });

  it('counts a hyphenated word, a number or an amount once', () => {
    expect(countWords('well-known community-led project')).toBe(3);
    expect(countWords('In 2026 we raised £25,000.')).toBe(5);
    expect(countWords('3.5 per cent')).toBe(3);
  });

  it('does not count punctuation on its own', () => {
    expect(countWords('Yes - and no ... — !')).toBe(3);
    expect(countWords('"Quoted," she said.')).toBe(3);
  });

  it('counts words in any script', () => {
    expect(countWords('Diolch yn fawr')).toBe(3);
    expect(countWords('café naïve')).toBe(2);
  });
});

describe('countCharacters', () => {
  it('counts code points, line breaks included', () => {
    expect(countCharacters('hall')).toBe(4);
    expect(countCharacters('a\nb')).toBe(3);
    expect(countCharacters('£25')).toBe(3);
    expect(countCharacters('𝒜')).toBe(1);
  });
});
