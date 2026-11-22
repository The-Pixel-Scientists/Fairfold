// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one name normaliser (ADR 0025, ADR 0031), used for the list's entries
// when they are stored and for every name screened, so the two always agree.
// A name is folded to lower case without accents, punctuation becomes a
// space, and for a person a leading honorific goes; for an organisation or
// ship a leading "the" and trailing legal-form words go. A name that would
// be left empty keeps its words.

export type NameKind = 'person' | 'organisation';

export const MAX_NORMALISED = 300;

/** Letters that have no decomposition, folded to the letters a keyboard has. */
const FOLDS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

const HONORIFICS: ReadonlySet<string> = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'dr',
  'prof',
  'sir',
  'dame',
  'lord',
  'lady',
]);

const LEGAL_FORMS: ReadonlySet<string> = new Set([
  'limited',
  'ltd',
  'cyfyngedig',
  'cyf',
  'plc',
  'llp',
  'cic',
  'cio',
]);

export function normaliseName(name: string, kind: NameKind): string {
  const folded = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ßæœøłđðþı]/g, (letter) => FOLDS[letter] ?? letter)
    .replaceAll('&', ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  const tokens = folded.split(' ').filter((token) => token !== '');
  if (kind === 'person') {
    while (tokens.length > 1 && HONORIFICS.has(tokens[0] ?? '')) tokens.shift();
  } else {
    if (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
    while (tokens.length > 1 && LEGAL_FORMS.has(tokens.at(-1) ?? '')) tokens.pop();
  }
  return tokens.join(' ').slice(0, MAX_NORMALISED).trim();
}

/** The normalised name, and with its words in reverse order, so "smith john" finds "john smith". */
export function nameVariants(normalised: string): readonly string[] {
  const reversed = normalised.split(' ').reverse().join(' ');
  return reversed === normalised ? [normalised] : [normalised, reversed];
}

/** Whether two normalised names have the same words in any order. */
export const sameWords = (a: string, b: string): boolean =>
  a.split(' ').sort().join(' ') === b.split(' ').sort().join(' ');
