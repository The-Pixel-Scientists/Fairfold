// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Building blocks for impact's schemas. Text is trimmed and free of
// characters that hide or reorder it; Postgres also refuses NUL. A checked
// list refuses a value with its own catalogue message, which a plain enum
// cannot carry through messageForIssue().

import { z } from 'zod';

import { impactMessages, says, type ImpactMessage } from './messages.ts';

const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** The same, except a line break. */
const HIDDEN_IN_TEXT = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/** One line, such as a name or a caption, which may not be empty. */
export function line(max: number, empty: ImpactMessage) {
  return z
    .string()
    .trim()
    .max(max)
    .refine((value) => !HIDDEN.test(value), says(impactMessages.hiddenCharacters))
    .refine((value) => value !== '', says(empty));
}

/** Paragraphs, with line breaks stored as `\n`. Empty means none. */
export function paragraphs(max: number) {
  return z
    .string()
    .overwrite((value) => value.replace(/\r\n?/g, '\n'))
    .trim()
    .max(max)
    .refine((value) => !HIDDEN_IN_TEXT.test(value), says(impactMessages.hiddenCharactersText));
}

/**
 * A value from a checked list in a request. Refused with `message`; the
 * OpenAPI document still lists the values.
 */
export function choice<const T extends readonly [string, ...string[]]>(
  values: T,
  message: ImpactMessage,
) {
  const allowed: readonly string[] = values;
  // nosemgrep: tps-contracts-meta-claims-no-checks -- the enum lists exactly the values the z.enum(values) pipe below checks, for the OpenAPI document; refine() gives the catalogue message first (ADR 0004)
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
    says(impactMessages.listedOnce),
  ] as const;
}

/**
 * The id of an outcome or indicator inside a framework: a uuid in lower
 * case, made by the console, as config diff paths take it.
 */
export const itemIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** Opaque to the apps: a page's `nextCursor`, sent back to read the next page. */
export const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

export const dateSchema = z.iso.date();

export const timestampSchema = z.iso.datetime();

/** A period of whole days, both ends included. ISO dates compare as text. */
export const periodShape = { periodStart: dateSchema, periodEnd: dateSchema };

export function periodInOrder({
  periodStart,
  periodEnd,
}: {
  periodStart: string;
  periodEnd: string;
}) {
  return periodStart <= periodEnd;
}
