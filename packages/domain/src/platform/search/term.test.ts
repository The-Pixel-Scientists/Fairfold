// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { normaliseSearchTerm, searchTermSchema } from './term.ts';

describe('normaliseSearchTerm', () => {
  it('folds compatibility forms, collapses whitespace and trims', () => {
    expect(normaliseSearchTerm('  Ｆｒｅｄ\t\n ﬁsh  ')).toBe('Fred fish');
  });
});

describe('searchTermSchema', () => {
  it('takes 2 to 100 characters after normalising', () => {
    expect(searchTermSchema.parse('  Al   Smith ')).toBe('Al Smith');
    expect(searchTermSchema.parse(`${'a'.repeat(100)}   `)).toHaveLength(100);
    expect(searchTermSchema.safeParse(' a ').success).toBe(false);
    expect(searchTermSchema.safeParse('a'.repeat(101)).success).toBe(false);
  });

  it('refuses control characters and halves of a character', () => {
    for (const term of ['Smith\u0000', 'Sm\u0007ith', 'Smith\u007f', 'Smith\ud800']) {
      expect(searchTermSchema.safeParse(term).success, JSON.stringify(term)).toBe(false);
    }
  });
});
