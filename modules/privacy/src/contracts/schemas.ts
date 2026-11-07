// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Building blocks for privacy's schemas. Text is trimmed and free of
// characters that hide or reorder it; Postgres also refuses NUL. A checked
// list refuses a value with its own catalogue message, which a plain enum
// cannot carry through messageForIssue().

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { privacyMessages, says, type PrivacyMessage } from './messages.ts';

const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** The same, except a line break. */
const HIDDEN_IN_TEXT = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/** One line, such as a name or a reference, which may not be empty. */
export function line(max: number, empty: PrivacyMessage) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => !HIDDEN.test(value), says(privacyMessages.hiddenCharacters))
    .refine((value) => value !== '', says(empty));
}

/** Paragraphs, with line breaks stored as `\n`. Empty means none, unless `empty` names a message. */
export function paragraphs(max: number, empty?: PrivacyMessage) {
  const text = z
    .string()
    .overwrite((value) => value.replace(/\r\n?/g, '\n'))
    .trim()
    .max(max)
    .refine((value) => !HIDDEN_IN_TEXT.test(value), says(privacyMessages.hiddenCharactersText));
  return empty === undefined ? text : text.refine((value) => value !== '', says(empty));
}

/** A value from a checked list in a request, refused with `message`; the OpenAPI document lists the values. */
export function choice<const T extends readonly [string, ...string[]]>(
  values: T,
  message: PrivacyMessage,
) {
  const allowed: readonly string[] = values;
  // nosemgrep: tps-contracts-meta-claims-no-checks -- the enum lists exactly the values the z.enum(values) pipe below checks, for the OpenAPI document; refine() gives the catalogue message first (ADR 0004)
  return z
    .string()
    .refine((value) => allowed.includes(value), { ...says(message), abort: true })
    .meta({ enum: [...values] })
    .pipe(z.enum(values));
}

/** A list of values from a checked list, each once. */
export function choices<const T extends readonly [string, ...string[]]>(
  values: T,
  message: PrivacyMessage,
) {
  return z
    .array(choice(values, message))
    .max(values.length)
    .refine((items) => new Set(items).size === items.length, says(privacyMessages.listedOnce));
}

/** Ids, each once. */
export function ids(max: number) {
  return z
    .array(idSchema)
    .max(max)
    .refine((items) => new Set(items).size === items.length, says(privacyMessages.listedOnce));
}

/** Opaque to the apps: a page's `nextCursor`, sent back to read the next page. */
export const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/** A calendar date, in the tenant's time zone where it is a deadline. */
export const dateSchema = z.iso.date();

export const timestampSchema = z.iso.datetime();
