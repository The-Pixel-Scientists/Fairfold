// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one way words and characters are counted, in the browser as the
// applicant types and on the server when it checks, so the two never differ.

/**
 * Words as people count them: runs of text between spaces or line breaks
 * that hold a letter or a digit. A hyphenated word, or a number such as
 * £25,000, counts once; punctuation on its own does not count.
 */
export function countWords(text: string): number {
  return text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Characters as code points, so a letter outside the basic plane counts once. */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}
