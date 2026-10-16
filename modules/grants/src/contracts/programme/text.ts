// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Plain text as staff enter it in programme set-up: trimmed, and free of
// characters that hide or reorder text. Postgres also refuses NUL.

import { z } from 'zod';

import { programmeMessages, says, type ProgrammeMessage } from './messages.ts';

const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** The same, except a line break. */
const HIDDEN_IN_TEXT = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/** One line, such as a title or a subject, which may not be empty. */
export function line(max: number, empty: ProgrammeMessage) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => !HIDDEN.test(value), says(programmeMessages.hiddenCharacters))
    .refine((value) => value !== '', says(empty));
}

/** Paragraphs, with line breaks stored as `\n`. Left out or empty means none. */
export function paragraphs(max: number) {
  return z
    .string()
    .overwrite((value) => value.replace(/\r\n?/g, '\n'))
    .trim()
    .max(max)
    .refine((value) => !HIDDEN_IN_TEXT.test(value), says(programmeMessages.hiddenCharactersText));
}
