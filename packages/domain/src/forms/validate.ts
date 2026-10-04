// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Checks an application's answers against its pinned definition, the same
// way in the browser and on the server (architecture rules 6 and 7). The
// server's check is the one that counts: anything the browser should have
// stopped is refused here too.
//   - Answers are keyed by field id; an answer to anything that is not a
//     question on this form, or to a question not shown, is refused.
//   - Each answer must already be of its field's type: nothing is converted.
//   - `draft` checks the answers given; `submit` also needs every shown
//     required question answered.
// No answer is `null` or an absent key for any field, a blank string for a
// field whose answer is a string, or an empty list for multiple choice. Any
// other value, empty or not, is checked against the field's type.

import { z } from 'zod';

import { messages, type FieldProblem } from '../platform/messages.ts';
import { moneySchema } from '../platform/money.ts';
import { ukAddressSchema } from './answers.ts';
import {
  fieldIdSchema,
  LONG_TEXT_MAX_CHARACTERS,
  questionsOf,
  SHORT_TEXT_MAX_CHARACTERS,
  type Question,
} from './definition.ts';
import { formMessages as m } from './messages.ts';
import type { FormDefinition } from './rules.ts';
import { visibleFields, type Answers } from './visibility.ts';
import { countCharacters, countWords } from './words.ts';

export type ValidationMode = 'draft' | 'submit';

const emailFormat = z.email().max(254);
const webAddress = z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(2048);
const PHONE = /^\+?[0-9 ()-]{7,24}$/;
const UK_POSTCODE = /^[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}$/;

const STRING_ANSWERS = new Set<Question['type']>([
  'short_text',
  'long_text',
  'date',
  'email',
  'phone',
  'url',
  'single_choice',
  'dropdown',
]);

function isNoAnswer(field: Question, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return STRING_ANSWERS.has(field.type) && value.trim() === '';
  return field.type === 'multiple_choice' && Array.isArray(value) && value.length === 0;
}

function isRealDate(value: unknown): boolean {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (match === null) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function textProblem(field: Question & { type: 'short_text' | 'long_text' }, value: unknown) {
  if (typeof value !== 'string') return messages.enterText;
  if (field.type === 'short_text' && /[\r\n]/.test(value)) return m.oneLine;
  const hardMax =
    field.type === 'short_text' ? SHORT_TEXT_MAX_CHARACTERS : LONG_TEXT_MAX_CHARACTERS;
  const maxCharacters = field.maxCharacters ?? hardMax;
  const characters = countCharacters(value);
  if (characters > maxCharacters) return m.tooManyCharacters(maxCharacters, characters);
  if (field.maxWords !== undefined) {
    const words = countWords(value);
    if (words > field.maxWords) return m.tooManyWords(field.maxWords, words);
  }
  return undefined;
}

function numberProblem(field: Question & { type: 'number' }, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return messages.enterNumber;
  if (field.wholeNumber && !Number.isInteger(value)) return messages.enterWholeNumber;
  const { min, max } = field;
  if (min !== undefined && max !== undefined) {
    return value < min || value > max ? m.numberBetween(min, max) : undefined;
  }
  if (min !== undefined && value < min) return m.numberAtLeast(min);
  if (max !== undefined && value > max) return m.numberAtMost(max);
  return undefined;
}

function amountProblem(field: Question & { type: 'currency' }, value: unknown) {
  const parsed = moneySchema.safeParse(value);
  // GBP is the only currency, so the money check also checks the field's currency.
  if (!parsed.success) return messages.currency;
  const amount = parsed.data.amountMinor;
  const min = { amountMinor: field.minMinor, currency: field.currency };
  if (field.maxMinor === undefined)
    return amount < field.minMinor ? m.amountAtLeast(min) : undefined;
  if (amount >= field.minMinor && amount <= field.maxMinor) return undefined;
  return m.amountBetween(min, { amountMinor: field.maxMinor, currency: field.currency });
}

function choiceProblem(field: Question & { type: 'multiple_choice' }, value: unknown) {
  const values = field.options.map((option) => option.value);
  if (!Array.isArray(value) || !value.every((item) => values.includes(item as string))) {
    return m.chooseOption;
  }
  if (new Set(value).size !== value.length) return m.chooseEachOnce;
  if (field.minSelections !== undefined && value.length < field.minSelections) {
    return m.chooseAtLeast(field.minSelections);
  }
  if (field.maxSelections !== undefined && value.length > field.maxSelections) {
    return m.chooseAtMost(field.maxSelections);
  }
  return undefined;
}

function addressProblems(field: Question, value: unknown): FieldProblem[] {
  const parsed = ukAddressSchema.safeParse(value);
  if (!parsed.success) return [{ field: field.id, message: m.address }];
  const { line1, town, postcode } = parsed.data;
  const problems: FieldProblem[] = [];
  if (line1.trim() === '') problems.push({ field: `${field.id}.line1`, message: m.addressLine1 });
  if (town.trim() === '') problems.push({ field: `${field.id}.town`, message: m.addressTown });
  if (!UK_POSTCODE.test(postcode))
    problems.push({ field: `${field.id}.postcode`, message: m.postcode });
  return problems;
}

function answerProblems(field: Question, value: unknown): FieldProblem[] {
  const one = (message: string | undefined) =>
    message === undefined ? [] : [{ field: field.id, message }];
  switch (field.type) {
    case 'short_text':
    case 'long_text':
      return one(textProblem(field, value));
    case 'number':
      return one(numberProblem(field, value));
    case 'currency':
      return one(amountProblem(field, value));
    case 'date':
      return one(isRealDate(value) ? undefined : m.realDate);
    case 'email':
      return one(emailFormat.safeParse(value).success ? undefined : messages.email);
    case 'phone': {
      const digits = typeof value === 'string' ? value.replace(/\D/g, '').length : 0;
      const valid = typeof value === 'string' && PHONE.test(value) && digits >= 7 && digits <= 15;
      return one(valid ? undefined : m.phone);
    }
    case 'url':
      return one(webAddress.safeParse(value).success ? undefined : m.webAddress);
    case 'single_choice':
    case 'dropdown':
      return one(
        field.options.some((option) => option.value === value) ? undefined : m.chooseOption,
      );
    case 'multiple_choice':
      return one(choiceProblem(field, value));
    case 'yes_no':
      return one(typeof value === 'boolean' ? undefined : m.yesOrNo);
    case 'uk_address':
      return addressProblems(field, value);
  }
}

function requiredMessage(field: Question): string {
  if (field.type === 'multiple_choice') return m.chooseAtLeast(field.minSelections ?? 1);
  const choice =
    field.type === 'single_choice' || field.type === 'dropdown' || field.type === 'yes_no';
  return choice ? m.chooseAnswer : m.enterAnswer;
}

/**
 * Every problem with these answers, each naming its field id, or a part of
 * it such as `f_address.postcode`. A key that is not a field id is named
 * `*`, so nothing the sender chose is repeated. Empty means valid.
 */
export function validateAnswers(
  definition: FormDefinition,
  answers: unknown,
  mode: ValidationMode,
): FieldProblem[] {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
    return [{ field: '*', message: messages.sendObject }];
  }
  const given = answers as Answers;
  const questions = new Map(questionsOf(definition).map((field) => [field.id, field]));
  const problems: FieldProblem[] = [];
  for (const key of Object.keys(given)) {
    if (questions.has(key)) continue;
    const field = fieldIdSchema.safeParse(key).success ? key : '*';
    problems.push({ field, message: m.notOnForm });
  }
  const shown = new Set(visibleFields(definition, given).map((field) => field.id));
  for (const field of questions.values()) {
    const value = Object.hasOwn(given, field.id) ? given[field.id] : undefined;
    if (isNoAnswer(field, value)) {
      if (mode === 'submit' && field.required && shown.has(field.id)) {
        problems.push({ field: field.id, message: requiredMessage(field) });
      }
    } else if (!shown.has(field.id)) {
      problems.push({ field: field.id, message: m.notShown });
    } else {
      problems.push(...answerProblems(field, value));
    }
  }
  return problems;
}
