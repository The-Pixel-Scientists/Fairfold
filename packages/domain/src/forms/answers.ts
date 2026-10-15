// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Answers as a request carries them: keyed by field id, each a value of one
// of the answer types. This bounds what a request may hold; validateAnswers()
// then checks each answer against its own field.

import { z } from 'zod';

import { moneySchema } from '../platform/money.ts';
import {
  CELL_MAX_CHARACTERS,
  columnIdSchema,
  fieldIdSchema,
  LONG_TEXT_MAX_CHARACTERS,
  optionValueSchema,
  TABLE_MAX_ROWS,
} from './definition.ts';

export const ukAddressSchema = z.strictObject({
  line1: z.string().max(100),
  line2: z.string().max(100).optional(),
  town: z.string().max(100),
  county: z.string().max(100).optional(),
  postcode: z.string().max(10),
});

export type UkAddress = z.output<typeof ukAddressSchema>;

/** One cell of a table answer: text or an option value, a number, an amount, or nothing. */
export const cellValueSchema = z.union([
  z.string().max(CELL_MAX_CHARACTERS * 2),
  z.number(),
  moneySchema,
  z.null(),
]);

/** A table's rows, each keyed by column id. */
export const tableRowsSchema = z
  .array(z.record(columnIdSchema, cellValueSchema))
  .max(TABLE_MAX_ROWS);

/** `null` means no answer; validateAnswers() decides what else does, by field type. */
export const answerValueSchema = z.union([
  // Characters are counted as code points; a code point can take two UTF-16 units.
  z.string().max(LONG_TEXT_MAX_CHARACTERS * 2),
  z.number(),
  z.boolean(),
  z.array(optionValueSchema).max(100),
  moneySchema,
  ukAddressSchema,
  tableRowsSchema,
  z.null(),
]);

export const answersSchema = z.record(fieldIdSchema, answerValueSchema);
