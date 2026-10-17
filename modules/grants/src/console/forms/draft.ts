// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changing a form definition as the builder does: each function takes part of
// a definition and gives back a changed copy. Ids are made here, once, and are
// never shown or edited, because answers, conditions and eligibility refer to
// them (architecture rule 7).

import { fileTypes, MAX_FILE_BYTES } from '@pixel-scientists/domain/files';
import { CELL_MAX_CHARACTERS, fieldAudiences, fieldsOf } from '@pixel-scientists/domain/forms';
import type { Condition, FormDefinition, Question } from '@pixel-scientists/domain/forms';

export type Section = FormDefinition['sections'][number];
export type EditableType = Question['type'];
export type TableQuestion = Extract<Question, { type: 'table' }>;
export type FileQuestion = Extract<Question, { type: 'file' }>;
export type Column = TableQuestion['columns'][number];
export type ColumnType = Column['type'];
export type ChoiceQuestion = Extract<
  Question,
  { type: 'single_choice' | 'dropdown' | 'multiple_choice' }
>;
export type Choice = ChoiceQuestion['options'][number];

/** Random letters and digits, which every page can make, whatever address it is served from. */
const randomId = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) =>
    (byte % 36).toString(36),
  ).join('');

export const newChoice = (): Choice => ({ value: `o_${randomId(8)}`, label: '' });

/** The most columns the form engine allows a table. A test keeps the two in step. */
export const MAX_COLUMNS = 6;

/** A column that takes a short text, with an id that no other column has had, so a column added again is a new one. */
export const newColumn = (): Column => ({
  id: `c_${randomId(12)}`,
  type: 'short_text',
  label: '',
  required: true,
  total: false,
  maxCharacters: CELL_MAX_CHARACTERS,
});

/** The column as another type. Its id, label and whether it is required stay; a total stays between number and amount columns. */
export function withColumnType(column: Column, type: ColumnType): Column {
  const { id, label, required } = column;
  const common = { id, label, required };
  switch (type) {
    case 'short_text':
      return { ...common, type, total: false, maxCharacters: CELL_MAX_CHARACTERS };
    case 'number':
      return { ...common, type, total: column.total, wholeNumber: false };
    case 'currency':
      return { ...common, type, total: column.total, currency: 'GBP', minMinor: 0 };
    case 'dropdown':
      return { ...common, type, total: false, options: [newChoice(), newChoice()] };
  }
}

/** A question that asks for a short answer, to start from. Applicants must answer it unless the manager says not. */
export function blankQuestion(): Question {
  return {
    id: `f_${randomId(12)}`,
    type: 'short_text',
    label: '',
    required: true,
    identity: false,
    audiences: [...fieldAudiences],
    conditions: [],
  };
}

/** A section with one blank question, because a section needs at least one. */
export function blankSection(): Section {
  return { id: `s_${randomId(12)}`, title: '', conditions: [], fields: [blankQuestion()] };
}

/**
 * The question as another type. What every question has stays, and so do the
 * choices between types that have them; limits and eligibility rules belong
 * to their type and start again. A file question is never "only in totals".
 */
export function withType(question: Question, type: EditableType): Question {
  const { id, label, hint, required, identity, audiences, conditions } = question;
  const common = { id, label, hint, required, identity, audiences, conditions };
  const options = 'options' in question ? question.options : [newChoice(), newChoice()];
  switch (type) {
    case 'short_text':
      return { ...common, type };
    case 'long_text':
      return { ...common, type };
    case 'number':
      return { ...common, type, wholeNumber: false };
    case 'currency':
      return { ...common, type, currency: 'GBP', minMinor: 0 };
    case 'date':
    case 'email':
    case 'phone':
    case 'url':
    case 'yes_no':
    case 'uk_address':
      return { ...common, type };
    case 'single_choice':
    case 'dropdown':
    case 'multiple_choice':
      return { ...common, type, options };
    case 'table':
      return { ...common, type, rowNoun: 'row', minRows: 0, maxRows: 20, columns: [newColumn()] };
    case 'file':
      return {
        ...common,
        type,
        audiences: audiences === 'aggregate_only' ? [...fieldAudiences] : audiences,
        allowedTypes: [...fileTypes],
        maxBytes: MAX_FILE_BYTES,
        maxFiles: 1,
      };
  }
}

/** The list with the item at `index` moved by `by`, or as it was when there is nowhere to move it. */
export function moved<T>(items: readonly T[], index: number, by: -1 | 1): readonly T[] {
  const item = items[index];
  const target = index + by;
  if (item === undefined || target < 0 || target >= items.length) return items;
  const rest = items.filter((_, position) => position !== index);
  rest.splice(target, 0, item);
  return rest;
}

/** The choice question without one of its choices, and without it among the answers that stop applicants. */
export function withoutChoice(question: ChoiceQuestion, value: string): ChoiceQuestion {
  const options = question.options.filter((choice) => choice.value !== value);
  if (question.type !== 'single_choice') return { ...question, options };
  const { eligibility } = question;
  const stopValues = eligibility?.stopValues.filter((stop) => stop !== value) ?? [];
  return {
    ...question,
    options,
    eligibility:
      eligibility !== undefined && stopValues.length > 0
        ? { ...eligibility, stopValues }
        : undefined,
  };
}

const CONDITION_TYPES = ['yes_no', 'single_choice', 'dropdown', 'multiple_choice'];

/** The questions a condition can read: those before this one that take a choice or yes or no. */
export function conditionSources(definition: FormDefinition, fieldId: string): Question[] {
  const sources: Question[] = [];
  for (const field of fieldsOf(definition)) {
    if (field.id === fieldId) break;
    if (field.type !== 'content' && CONDITION_TYPES.includes(field.type)) sources.push(field);
  }
  return sources;
}

/** Each answer a condition can ask for on this question, in words, with the condition it makes. */
export function conditionAnswers(source: Question): { label: string; condition: Condition }[] {
  const field = source.id;
  switch (source.type) {
    case 'yes_no':
      return [
        { label: 'Yes', condition: { field, equals: true } },
        { label: 'No', condition: { field, equals: false } },
      ];
    case 'single_choice':
    case 'dropdown':
      return source.options.map(({ value, label }) => ({
        label,
        condition: { field, equals: value },
      }));
    case 'multiple_choice':
      return source.options.map(({ value, label }) => ({
        label,
        condition: { field, includes: value },
      }));
    default:
      return [];
  }
}
