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
// field whose answer is a string, or an empty list for multiple choice or a
// table. Any other value, empty or not, is checked against the field's type.
// A table's cells follow the same rules, by their column's type, and a
// problem with one cell names it `<field id>.<row from 1>.<column id>`.
// A file question's answer is the ids of its linked files, and an empty list
// is no answer. The server adds them from its join table before it checks
// or projects answers; a client never sends them (ADR 0047).

import { z } from 'zod';

import { idSchema } from '../id.ts';
import { messages, type FieldProblem } from '../platform/messages.ts';
import { moneySchema } from '../platform/money.ts';
import { ukAddressSchema } from './answers.ts';
import {
  fieldIdSchema,
  LONG_TEXT_MAX_CHARACTERS,
  questionsOf,
  SHORT_TEXT_MAX_CHARACTERS,
  type FileField,
  type Question,
  type TableColumn,
  type TableField,
} from './definition.ts';
import { formMessages as m, type AnswerWords } from './messages.ts';
import type { FormDefinition } from './rules.ts';
import { visibleFields, type Answers } from './visibility.ts';
import { countCharacters, countWords } from './words.ts';

export type ValidationMode = 'draft' | 'submit';

const emailFormat = z.email().max(254);
const webAddress = z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(2048);
const PHONE = /^\+?[0-9 ()-]{7,24}$/;
const UK_POSTCODE = /^[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}$/;

/** The answer messages for a question; m.cell() gives them for a table cell. */
const questionWords: AnswerWords = {
  enterText: messages.enterText,
  oneLine: m.oneLine,
  tooManyCharacters: m.tooManyCharacters,
  enterNumber: messages.enterNumber,
  enterWholeNumber: messages.enterWholeNumber,
  numberBetween: m.numberBetween,
  numberAtLeast: m.numberAtLeast,
  numberAtMost: m.numberAtMost,
  amountInPounds: messages.currency,
  amountBetween: m.amountBetween,
  amountAtLeast: m.amountAtLeast,
  chooseOption: m.chooseOption,
};

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
  const list = field.type === 'multiple_choice' || field.type === 'table' || field.type === 'file';
  return list && Array.isArray(value) && value.length === 0;
}

/** A blank cell, by the same rule: text and dropdown cells hold strings. */
function isBlankCell(column: TableColumn, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const text = column.type === 'short_text' || column.type === 'dropdown';
  return text && typeof value === 'string' && value.trim() === '';
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

interface TextRule {
  type: 'short_text' | 'long_text';
  maxCharacters?: number | undefined;
  maxWords?: number | undefined;
}

function textProblem(field: TextRule, value: unknown, say = questionWords) {
  if (typeof value !== 'string') return say.enterText;
  if (field.type === 'short_text' && /[\r\n]/.test(value)) return say.oneLine;
  const hardMax =
    field.type === 'short_text' ? SHORT_TEXT_MAX_CHARACTERS : LONG_TEXT_MAX_CHARACTERS;
  const maxCharacters = field.maxCharacters ?? hardMax;
  const characters = countCharacters(value);
  if (characters > maxCharacters) return say.tooManyCharacters(maxCharacters, characters);
  if (field.maxWords !== undefined) {
    const words = countWords(value);
    if (words > field.maxWords) return m.tooManyWords(field.maxWords, words);
  }
  return undefined;
}

type NumberRule = Pick<Extract<TableColumn, { type: 'number' }>, 'wholeNumber' | 'min' | 'max'>;

function numberProblem(field: NumberRule, value: unknown, say = questionWords) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return say.enterNumber;
  if (field.wholeNumber && !Number.isInteger(value)) return say.enterWholeNumber;
  const { min, max } = field;
  if (min !== undefined && max !== undefined) {
    return value < min || value > max ? say.numberBetween(min, max) : undefined;
  }
  if (min !== undefined && value < min) return say.numberAtLeast(min);
  if (max !== undefined && value > max) return say.numberAtMost(max);
  return undefined;
}

type AmountRule = Pick<
  Extract<TableColumn, { type: 'currency' }>,
  'currency' | 'minMinor' | 'maxMinor'
>;

function amountProblem(field: AmountRule, value: unknown, say = questionWords) {
  const parsed = moneySchema.safeParse(value);
  // GBP is the only currency, so the money check also checks the field's currency.
  if (!parsed.success) return say.amountInPounds;
  const amount = parsed.data.amountMinor;
  const min = { amountMinor: field.minMinor, currency: field.currency };
  if (field.maxMinor === undefined)
    return amount < field.minMinor ? say.amountAtLeast(min) : undefined;
  if (amount >= field.minMinor && amount <= field.maxMinor) return undefined;
  return say.amountBetween(min, { amountMinor: field.maxMinor, currency: field.currency });
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

/**
 * A lower-case uuid, checked by field type and never through the answer
 * union, where it would also pass as an option value.
 */
const isFileId = (id: unknown): boolean =>
  typeof id === 'string' && id === id.toLowerCase() && idSchema.safeParse(id).success;

function fileProblem(field: FileField, value: unknown) {
  if (!Array.isArray(value) || !value.every(isFileId)) return m.fileIds;
  if (new Set(value).size !== value.length) return m.uploadEachOnce;
  return value.length > field.maxFiles ? m.uploadAtMost(field.maxFiles) : undefined;
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

function cellProblem(column: TableColumn, value: unknown, say: AnswerWords) {
  switch (column.type) {
    case 'short_text':
      return textProblem(column, value, say);
    case 'number':
      return numberProblem(column, value, say);
    case 'currency':
      return amountProblem(column, value, say);
    case 'dropdown':
      return column.options.some((option) => option.value === value) ? undefined : say.chooseOption;
  }
}

function blankCellMessage(column: TableColumn, row: string): string {
  if (column.type === 'number') return m.enterCellNumber(row);
  if (column.type === 'currency') return m.enterCellAmount(row);
  return column.type === 'dropdown' ? m.chooseCell(row) : m.enterCell(row);
}

const isRow = (row: unknown): row is Record<string, unknown> =>
  typeof row === 'object' && row !== null && !Array.isArray(row);

/**
 * A table's shape and row count, named by the field id, then each cell.
 * `submit` also needs the fewest rows, required cells filled, and no row
 * left blank; a blank row gets one problem, not one per cell.
 */
function tableProblems(field: TableField, value: unknown, mode: ValidationMode): FieldProblem[] {
  const whole = (message: string) => [{ field: field.id, message }];
  if (!Array.isArray(value) || !value.every(isRow)) return whole(m.tableRows);
  if (value.length > field.maxRows) return whole(m.rowsAtMost(field.maxRows, field.rowNoun));
  const columns = new Set(field.columns.map((column) => column.id));
  if (value.some((row) => Object.keys(row).some((key) => !columns.has(key)))) {
    return whole(m.notInTable);
  }
  const problems: FieldProblem[] = [];
  const fewest = Math.max(field.minRows, field.required ? 1 : 0);
  if (mode === 'submit' && value.length < fewest) {
    problems.push(...whole(m.rowsAtLeast(fewest, field.rowNoun)));
  }
  value.forEach((row, index) => {
    const name = `${field.rowNoun} ${index + 1}`;
    const cell = (column: TableColumn) =>
      Object.hasOwn(row, column.id) ? row[column.id] : undefined;
    if (field.columns.every((column) => isBlankCell(column, cell(column)))) {
      if (mode === 'submit') problems.push(...whole(m.emptyRow(name)));
      return;
    }
    const say = m.cell(name);
    for (const column of field.columns) {
      const entry = cell(column);
      let message: string | undefined;
      if (!isBlankCell(column, entry)) message = cellProblem(column, entry, say);
      else if (mode === 'submit' && column.required) message = blankCellMessage(column, name);
      if (message !== undefined) {
        problems.push({ field: `${field.id}.${index + 1}.${column.id}`, message });
      }
    }
  });
  return problems;
}

function answerProblems(field: Question, value: unknown, mode: ValidationMode): FieldProblem[] {
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
    case 'table':
      return tableProblems(field, value, mode);
    case 'file':
      return one(fileProblem(field, value));
  }
}

function requiredMessage(field: Question): string {
  if (field.type === 'multiple_choice') return m.chooseAtLeast(field.minSelections ?? 1);
  if (field.type === 'table') return m.rowsAtLeast(Math.max(field.minRows, 1), field.rowNoun);
  if (field.type === 'file') return m.uploadFile;
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
      const needed = field.required || (field.type === 'table' && field.minRows > 0);
      if (mode === 'submit' && needed && shown.has(field.id)) {
        problems.push({ field: field.id, message: requiredMessage(field) });
      }
    } else if (!shown.has(field.id)) {
      problems.push({ field: field.id, message: m.notShown });
    } else {
      problems.push(...answerProblems(field, value, mode));
    }
  }
  return problems;
}
