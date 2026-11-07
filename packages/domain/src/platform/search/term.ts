// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A search term (ADR 0025), normalised the same way in the browser and on the
// server. It travels in a request body only, and no message repeats it.

import { z } from 'zod';

import { messages } from '../messages.ts';

export const SEARCH_TERM_MIN_CHARACTERS = 2;
export const SEARCH_TERM_MAX_CHARACTERS = 100;

/** NFKC, with each run of whitespace made one space and the ends trimmed. */
export function normaliseSearchTerm(term: string): string {
  return term.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** Control characters, and halves of a character, left after normalising. */
const HIDDEN = /[\p{Cc}\p{Cs}]/u;

export const searchTermSchema = z
  .string()
  .overwrite(normaliseSearchTerm)
  .refine((term) => !HIDDEN.test(term), { error: messages.notValid })
  .min(SEARCH_TERM_MIN_CHARACTERS)
  .max(SEARCH_TERM_MAX_CHARACTERS)
  .brand<'SearchTerm'>();

export type SearchTerm = z.output<typeof searchTermSchema>;
