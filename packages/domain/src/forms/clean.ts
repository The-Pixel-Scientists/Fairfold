// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The no-answer rule and the cleaning built on it, shared by the renderer
// and the server so both agree on what counts as answered (architecture
// rule 6). `trim()` keeps U+200B, U+200C, U+200D and U+2060, so text made
// only of whitespace and invisible format characters (\p{Cf}) is blank.

import { questionsOf, type Question, type TableColumn } from './definition.ts';
import type { FormDefinition } from './rules.ts';
import type { Answers } from './visibility.ts';

const BLANK = /^[\s\p{Cf}]*$/u;

/** True for text holding nothing but whitespace and invisible format characters. */
export const isBlankText = (value: string): boolean => BLANK.test(value);

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

/**
 * No answer: `null` or absent, blank text for a field whose answer is a
 * string, or an empty list for multiple choice, a table or a file question.
 */
export function isNoAnswer(field: Question, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return STRING_ANSWERS.has(field.type) && isBlankText(value);
  const list = field.type === 'multiple_choice' || field.type === 'table' || field.type === 'file';
  return list && Array.isArray(value) && value.length === 0;
}

/** A blank table cell, by the same rule: text and dropdown cells hold strings. */
export function isBlankCell(column: TableColumn, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const text = column.type === 'short_text' || column.type === 'dropdown';
  return text && typeof value === 'string' && isBlankText(value);
}

/**
 * The answers to store: each question's no-answer becomes `null`, and every
 * other value, including keys that are not questions on this form, is kept
 * exactly as given for validateAnswers() to judge. Nothing inside a real
 * answer is trimmed or converted.
 */
export function cleanAnswers(definition: FormDefinition, answers: Answers): Answers {
  const questions = new Map(questionsOf(definition).map((field) => [field.id, field]));
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    const field = questions.get(key);
    cleaned[key] = field !== undefined && isNoAnswer(field, value) ? null : value;
  }
  return cleaned;
}
