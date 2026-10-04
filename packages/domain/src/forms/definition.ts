// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The shape of a form definition: sections of fields, each with a stable id
// that answers are keyed by (architecture rule 7). A published version is
// immutable, so it is stored as parsed, with every default written out. The
// rules that join fields together, such as conditions and eligibility, are
// in rules.ts.

import { z } from 'zod';

import { catalogueParams } from '../platform/messages.ts';
import { currencies } from '../platform/money.ts';
import { formMessages } from './messages.ts';

/** Answers are keyed by these. A published id always means the same question. */
export const fieldIdSchema = z.string().regex(/^f_[a-z0-9]{1,32}$/);
export const sectionIdSchema = z.string().regex(/^s_[a-z0-9]{1,32}$/);
/** Stable too: conditions, eligibility and answers refer to them. */
export const optionValueSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);

export const SHORT_TEXT_MAX_CHARACTERS = 500;
export const LONG_TEXT_MAX_CHARACTERS = 20_000;

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

const options = z
  .array(z.strictObject({ value: optionValueSchema, label: z.string().min(1).max(200) }))
  .min(2)
  .max(100);

const explanation = z.string().min(1).max(1000);
const limit = (max: number) => z.int().min(1).max(max).optional();

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
  z.strictObject({
    ...question,
    type: z.literal('number'),
    wholeNumber: z.boolean().default(false),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    ...question,
    type: z.literal('currency'),
    currency: z.enum(currencies).default('GBP'),
    /** In minor units, like every amount. No amount is below zero. */
    minMinor: z.int().min(0).default(0),
    maxMinor: z.int().min(0).optional(),
  }),
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
export type Condition = z.output<typeof conditionSchema>;

/** Every field, in the order the applicant meets them. */
export function fieldsOf(definition: DefinitionShape): FormField[] {
  return definition.sections.flatMap((section) => section.fields);
}

/** Every field that takes an answer. */
export function questionsOf(definition: DefinitionShape): Question[] {
  return fieldsOf(definition).filter((field): field is Question => field.type !== 'content');
}
