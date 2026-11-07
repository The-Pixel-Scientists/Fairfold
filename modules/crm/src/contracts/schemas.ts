// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Building blocks for crm's schemas. Text is trimmed and free of characters
// that hide or reorder it; Postgres also refuses NUL. A checked list refuses
// a value with its own catalogue message, which a plain enum cannot carry
// through messageForIssue(). GET routes take a cursor and nothing else, so no
// search term or filter ever reaches a URL (ADR 0025): filters travel in
// POST bodies.

import { z } from 'zod';

import { crmMessages, says, type CrmMessage } from './messages.ts';

export const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** The same, except a line break. */
const HIDDEN_IN_TEXT = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/** One line, such as a name, which may not be empty. */
export function line(max: number, empty: CrmMessage) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => !HIDDEN.test(value), says(crmMessages.hiddenCharacters))
    .refine((value) => value !== '', says(empty));
}

/** Paragraphs, with line breaks stored as `\n`. Empty means none. */
export function paragraphs(max: number) {
  return z
    .string()
    .overwrite((value) => value.replace(/\r\n?/g, '\n'))
    .trim()
    .max(max)
    .refine((value) => !HIDDEN_IN_TEXT.test(value), says(crmMessages.hiddenCharactersText));
}

/** A value from a checked list in a request, refused with `message`; the OpenAPI document still lists the values. */
export function choice<const T extends readonly [string, ...string[]]>(
  values: T,
  message: CrmMessage,
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
    says(crmMessages.listedOnce),
  ] as const;
}

/**
 * Marks a response field that holds personal data, so the console screens
 * (S12-42, S12-58) project it by audience and keep it out of logs. Shown as
 * `x-personal` in the OpenAPI document.
 */
export function personal<S extends z.ZodType>(schema: S): S {
  return schema.meta({ 'x-personal': true });
}

/** Whether a schema is marked by personal(). */
export function isPersonal(schema: z.ZodType): boolean {
  return schema.meta()?.['x-personal'] === true;
}

/** Opaque to the apps: a page's `nextCursor`, sent back to read the next page. */
export const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/** The only query a crm GET route takes. */
export const pageQuerySchema = z.strictObject({ cursor: cursorSchema.optional() });

/** Items in one page of any crm list. The server sets it; the apps cannot raise it. */
export const PAGE_SIZE = 50;

export const timestampSchema = z.iso.datetime({ offset: true });

export const dateSchema = z.iso.date();
