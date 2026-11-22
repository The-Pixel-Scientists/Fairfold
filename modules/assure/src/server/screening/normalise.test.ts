// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { nameVariants, normaliseName, sameWords } from './normalise.ts';

describe('normaliseName', () => {
  it('folds case, accents and punctuation', () => {
    expect(normaliseName("  Ångström-O'Brien,  JOSÉ ", 'person')).toBe('angstrom o brien jose');
  });

  it('folds letters that do not decompose and the ampersand', () => {
    expect(normaliseName('Łukasz Straße & Søn', 'person')).toBe('lukasz strasse and son');
  });

  it('folds compatibility forms to plain letters', () => {
    expect(normaliseName('ＩＮＶＥＮＴＥＤ Ｎａｍｅ', 'person')).toBe('invented name');
  });

  it('drops leading honorifics from a person only', () => {
    expect(normaliseName('Dr. Mrs Invented Person', 'person')).toBe('invented person');
    expect(normaliseName('Dr Invented', 'organisation')).toBe('dr invented');
  });

  it('drops a leading the and trailing legal forms from an organisation only', () => {
    expect(normaliseName('The Invented Trading Co. Ltd', 'organisation')).toBe(
      'invented trading co',
    );
    expect(normaliseName('Invented Community CIC Limited', 'organisation')).toBe(
      'invented community',
    );
    expect(normaliseName('Invented Ltd', 'person')).toBe('invented ltd');
  });

  it('keeps the words of a name that would be left empty', () => {
    expect(normaliseName('Limited', 'organisation')).toBe('limited');
    expect(normaliseName('Mr', 'person')).toBe('mr');
  });

  it('never passes the column limit', () => {
    expect(normaliseName('ß'.repeat(400), 'person')).toHaveLength(300);
  });

  it('gives the same answer for a transliteration that differs only by accents', () => {
    expect(normaliseName('Müller Čapek', 'person')).toBe(normaliseName('Muller Capek', 'person'));
  });
});

describe('name order', () => {
  it('offers the reversed order as a second variant', () => {
    expect(nameVariants('john smith')).toEqual(['john smith', 'smith john']);
    expect(nameVariants('smith')).toEqual(['smith']);
    expect(nameVariants('ann ann')).toEqual(['ann ann']);
  });

  it('treats the same words in another order as the same name', () => {
    expect(sameWords('smith john', 'john smith')).toBe(true);
    expect(sameWords('john smyth', 'john smith')).toBe(false);
  });
});
