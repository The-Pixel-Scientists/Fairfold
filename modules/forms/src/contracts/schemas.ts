// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Building blocks for the forms contracts: checked lists, text, paging, and
// the classification of every field a response exposes (rule 5). Text is
// trimmed and free of characters that hide or reorder it; Postgres also
// refuses NUL. A checked list refuses a value with its own catalogue
// message, which a plain enum cannot carry through messageForIssue().

import { z } from 'zod';

import { formsMessages, says, type FormsMessage } from './messages.ts';

/** Who may answer a form, as `config.ts` records it for `forms.form`. */
export const respondentOptions = ['signed_in', 'anonymous', 'both'] as const;

export type Respondents = (typeof respondentOptions)[number];

/** How one response was sent: through the portal, or a public page with no session. */
export const responseRoutes = ['signed_in', 'anonymous'] as const;

export type ResponseRoute = (typeof responseRoutes)[number];

/** A form is a draft until its first version is published. */
export const formStatuses = ['draft', 'published'] as const;

export const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** The same, except a line break. */
export const HIDDEN_IN_TEXT = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/** One line, such as a title, which may not be empty. */
export function line(max: number, empty: FormsMessage) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => !HIDDEN.test(value), says(formsMessages.hiddenCharacters))
    .refine((value) => value !== '', says(empty));
}

/** Paragraphs, with line breaks stored as `\n`. Empty means none. */
export function paragraphs(max: number) {
  return z
    .string()
    .overwrite((value) => value.replace(/\r\n?/g, '\n'))
    .trim()
    .max(max)
    .refine((value) => !HIDDEN_IN_TEXT.test(value), says(formsMessages.hiddenCharactersText));
}

/** A value from a checked list in a request, refused with `message` rather than a generic one. */
export function choice<const T extends readonly [string, ...string[]]>(
  values: T,
  message: FormsMessage,
) {
  const allowed: readonly string[] = values;
  return z
    .string()
    .refine((value) => allowed.includes(value), { ...says(message), abort: true })
    .pipe(z.enum(values));
}

/** Opaque to the apps: a page's `nextCursor`, sent back to read the next page. */
export const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

/** A time in UTC, such as `2027-03-01T09:00:00Z`. */
export const timestampSchema = z.iso.datetime();

/**
 * How sensitive a response field is, for the schema's classification file,
 * export and the warehouse. `answers` is classified field by field, only by
 * answerClassifications() on the pinned form version.
 */
export type FieldClass = 'public' | 'internal' | 'personal' | 'answers';

export type FieldClasses<S extends z.ZodObject> = { readonly [K in keyof S['shape']]: FieldClass };

const classes = new Map<z.ZodType, Readonly<Record<string, FieldClass>>>();

/** Registers a response schema's field classes beside it, and returns the schema unchanged. */
export function classified<S extends z.ZodObject>(schema: S, fields: FieldClasses<S>): S {
  classes.set(schema, fields);
  return schema;
}

/** A response schema's field classes, or undefined if it has none. */
export function fieldClassesOf(schema: unknown): Readonly<Record<string, FieldClass>> | undefined {
  return classes.get(schema as z.ZodType);
}
