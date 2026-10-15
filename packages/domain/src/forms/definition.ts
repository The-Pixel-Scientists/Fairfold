// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The shape of a form definition: sections of fields, each with a stable id
// that answers are keyed by (architecture rule 7). A published version is
// immutable, so it is stored as parsed, with every default written out. The
// rules that join fields together, such as conditions and eligibility, are
// in rules.ts.

import { z } from 'zod';

import { fileTypes, MAX_FILE_BYTES, MAX_FILES_PER_FIELD } from '../files/types.ts';
import { catalogueParams } from '../platform/messages.ts';
import { currencies } from '../platform/money.ts';
import { formMessages } from './messages.ts';

/** Answers are keyed by these. A published id always means the same question. */
export const fieldIdSchema = z.string().regex(/^f_[a-z0-9]{1,32}$/);
export const sectionIdSchema = z.string().regex(/^s_[a-z0-9]{1,32}$/);
/** A table's cells are keyed by these, within their row. */
export const columnIdSchema = z.string().regex(/^c_[a-z0-9]{1,32}$/);
/** Stable too: conditions, eligibility and answers refer to them. */
export const optionValueSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);

export const SHORT_TEXT_MAX_CHARACTERS = 500;
export const LONG_TEXT_MAX_CHARACTERS = 20_000;
export const TABLE_MAX_ROWS = 50;
export const CELL_MAX_CHARACTERS = 200;

export const fieldAudiences = ['applicant', 'staff', 'reviewer'] as const;

/**
 * Who sees the answer against an application: a set that always holds the
 * applicant, or `aggregate_only`, where the applicant sees their own answer,
 * staff and reviewers never do, and it counts only in aggregate reports.
 */
export const audiencesSchema = z.union([
  z.literal('aggregate_only'),
  z
    .array(z.enum(fieldAudiences))
    .refine((set) => set.includes('applicant') && new Set(set).size === set.length, {
      error: formMessages.audiences,
      params: catalogueParams,
    }),
]);

/** Shows the field or section when an earlier question's answer equals, or includes, a value. */
export const conditionSchema = z.union([
  z.strictObject({ field: fieldIdSchema, equals: z.union([optionValueSchema, z.boolean()]) }),
  z.strictObject({ field: fieldIdSchema, includes: optionValueSchema }),
]);

/** Every condition must hold. */
const conditions = z.array(conditionSchema).max(10).default([]);

const question = {
  id: fieldIdSchema,
  label: z.string().min(1).max(500),
  hint: z.string().min(1).max(1000).optional(),
  required: z.boolean().default(false),
  /** Names or identifies the applicant, so blind reviewers never see it. */
  identity: z.boolean().default(false),
  audiences: audiencesSchema.default([...fieldAudiences]),
  conditions,
};

const option = z.strictObject({ value: optionValueSchema, label: z.string().min(1).max(200) });
const options = z.array(option).min(2).max(100);

const explanation = z.string().min(1).max(1000);
const limit = (max: number) => z.int().min(1).max(max).optional();

const numberLimits = {
  wholeNumber: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
};

const currencyLimits = {
  currency: z.enum(currencies).default('GBP'),
  /** In minor units, like every amount. No amount is below zero. */
  minMinor: z.int().min(0).default(0),
  maxMinor: z.int().min(0).optional(),
};

const column = {
  id: columnIdSchema,
  label: z.string().min(1).max(100),
  required: z.boolean().default(true),
  /** Sums the column; definitionProblems() allows it on number and currency columns only. */
  total: z.boolean().default(false),
};

/** One column of a table question, checked as the question of the same type. */
export const tableColumnSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...column,
    type: z.literal('short_text'),
    maxCharacters: z.int().min(1).max(CELL_MAX_CHARACTERS).default(CELL_MAX_CHARACTERS),
  }),
  z.strictObject({ ...column, type: z.literal('number'), ...numberLimits }),
  z.strictObject({ ...column, type: z.literal('currency'), ...currencyLimits }),
  z.strictObject({ ...column, type: z.literal('dropdown'), options: options.max(50) }),
]);

export const fieldSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...question,
    type: z.literal('short_text'),
    maxWords: limit(100),
    maxCharacters: limit(SHORT_TEXT_MAX_CHARACTERS),
  }),
  z.strictObject({
    ...question,
    type: z.literal('long_text'),
    maxWords: limit(5000),
    maxCharacters: limit(LONG_TEXT_MAX_CHARACTERS),
  }),
  z.strictObject({ ...question, type: z.literal('number'), ...numberLimits }),
  z.strictObject({ ...question, type: z.literal('currency'), ...currencyLimits }),
  z.strictObject({ ...question, type: z.literal('date') }),
  z.strictObject({ ...question, type: z.literal('email') }),
  z.strictObject({ ...question, type: z.literal('phone') }),
  z.strictObject({ ...question, type: z.literal('url') }),
  z.strictObject({
    ...question,
    type: z.literal('single_choice'),
    options,
    /** Answers that stop the applicant, and what they are told. */
    eligibility: z
      .strictObject({ stopValues: z.array(optionValueSchema).min(1), explanation })
      .optional(),
  }),
  z.strictObject({ ...question, type: z.literal('dropdown'), options }),
  z.strictObject({
    ...question,
    type: z.literal('multiple_choice'),
    options,
    minSelections: limit(100),
    maxSelections: limit(100),
  }),
  z.strictObject({
    ...question,
    type: z.literal('yes_no'),
    eligibility: z.strictObject({ stopWhen: z.boolean(), explanation }).optional(),
  }),
  z.strictObject({ ...question, type: z.literal('uk_address') }),
  /** Rows of answers, such as a budget with one row per cost. */
  z.strictObject({
    ...question,
    type: z.literal('table'),
    /** One row, in the singular, as messages name it: "cost" gives "Enter an amount for cost 2". */
    rowNoun: z.string().min(1).max(40),
    minRows: z.int().min(0).max(TABLE_MAX_ROWS).default(0),
    maxRows: z.int().min(1).max(TABLE_MAX_ROWS).default(20),
    columns: z.array(tableColumnSchema).min(1).max(6),
  }),
  /**
   * Files the applicant attaches (ADR 0047). Its answer is the ids of the
   * files linked to the application, which the server adds from its join
   * table: a client never sends them.
   */
  z.strictObject({
    ...question,
    type: z.literal('file'),
    allowedTypes: z
      .array(z.enum(fileTypes))
      .min(1)
      .max(fileTypes.length)
      .default([...fileTypes]),
    maxBytes: z.int().min(1024).max(MAX_FILE_BYTES).default(MAX_FILE_BYTES),
    maxFiles: z.int().min(1).max(MAX_FILES_PER_FIELD).default(1),
  }),
  /** Text for the applicant to read. It takes no answer. */
  z.strictObject({
    id: fieldIdSchema,
    type: z.literal('content'),
    body: z.string().min(1).max(5000),
    conditions,
  }),
]);

export const sectionSchema = z.strictObject({
  id: sectionIdSchema,
  title: z.string().min(1).max(200),
  introduction: z.string().min(1).max(2000).optional(),
  conditions,
  fields: z.array(fieldSchema).min(1).max(100),
});

/** The shape alone; formDefinitionSchema in rules.ts adds the rules between fields. */
export const definitionShapeSchema = z.strictObject({
  sections: z.array(sectionSchema).min(1).max(50),
});

export type DefinitionShape = z.output<typeof definitionShapeSchema>;
export type FormField = z.output<typeof fieldSchema>;
export type Question = Exclude<FormField, { type: 'content' }>;
export type TableField = Extract<FormField, { type: 'table' }>;
export type FileField = Extract<FormField, { type: 'file' }>;
export type TableColumn = z.output<typeof tableColumnSchema>;
export type Condition = z.output<typeof conditionSchema>;

/** Every field, in the order the applicant meets them. */
export function fieldsOf(definition: DefinitionShape): FormField[] {
  return definition.sections.flatMap((section) => section.fields);
}

/** Every field that takes an answer. */
export function questionsOf(definition: DefinitionShape): Question[] {
  return fieldsOf(definition).filter((field): field is Question => field.type !== 'content');
}
