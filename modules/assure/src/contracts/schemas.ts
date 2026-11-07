// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Building blocks for assure's schemas. Text is trimmed and free of
// characters that hide or reorder it; Postgres also refuses NUL. A checked
// list refuses a value with its own catalogue message, which a plain enum
// cannot carry through messageForIssue().

import { z } from 'zod';

import { assureMessages, says, type AssureMessage } from './messages.ts';

export const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** The same, except a line break. */
const HIDDEN_IN_TEXT = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/** One line, such as a name or a caption, which may not be empty. */
export function line(max: number, empty: AssureMessage) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => !HIDDEN.test(value), says(assureMessages.hiddenCharacters))
    .refine((value) => value !== '', says(empty));
}

/** Paragraphs, with line breaks stored as `\n`. Empty means none. */
export function paragraphs(max: number) {
  return z
    .string()
    .overwrite((value) => value.replace(/\r\n?/g, '\n'))
    .trim()
    .max(max)
    .refine((value) => !HIDDEN_IN_TEXT.test(value), says(assureMessages.hiddenCharactersText));
}

/**
 * A value from a checked list in a request. Refused with `message`; the
 * OpenAPI document still lists the values.
 */
export function choice<const T extends readonly [string, ...string[]]>(
  values: T,
  message: AssureMessage,
) {
  const allowed: readonly string[] = values;
  return z
    .string()
    .refine((value) => allowed.includes(value), { ...says(message), abort: true })
    .meta({ enum: [...values] })
    .pipe(z.enum(values));
}

/** A list in which `key` gives each item once. */
export function unique<T>(key: (item: T) => string) {
  return [
    (items: T[]) => new Set(items.map(key)).size === items.length,
    says(assureMessages.listedOnce),
  ] as const;
}

/** Opaque to the apps: a page's `nextCursor`, sent back to read the next page. */
export const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

export const dateSchema = z.iso.date();

export const timestampSchema = z.iso.datetime();
