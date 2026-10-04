// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The rules that join a definition's parts:
//   - every section and field id is used once;
//   - a condition reads a choice or yes or no question that comes before it,
//     with an answer that question can have, so conditions never form a cycle;
//   - a condition never reveals an answer: everyone who sees a field can see
//     every question that decides whether it shows;
//   - eligibility questions are required, seen by staff, and stop on some but
//     not all of their answers;
//   - options differ, lower limits are not above upper ones, and a form has
//     at most MAX_FIELDS questions.

import type { z } from 'zod';

import { catalogueParams } from '../platform/messages.ts';
import { canSee, projectionAudiences } from './audience.ts';
import {
  definitionShapeSchema,
  fieldsOf,
  type Condition,
  type DefinitionShape,
  type FormField,
} from './definition.ts';
import { formMessages as m, MAX_FIELDS } from './messages.ts';

type Path = (string | number)[];

interface Problem {
  path: Path;
  message: string;
}

/** The earlier question each condition reads, or a problem where it cannot. */
function conditionSources(
  conditions: readonly Condition[],
  earlier: ReadonlyMap<string, FormField>,
  path: Path,
  problems: Problem[],
): FormField[] {
  const sources: FormField[] = [];
  conditions.forEach((condition, index) => {
    const at = [...path, index];
    const source = earlier.get(condition.field);
    if (source === undefined) {
      problems.push({ path: [...at, 'field'], message: m.conditionSource });
      return;
    }
    const valid =
      'includes' in condition
        ? source.type === 'multiple_choice' &&
          source.options.some((option) => option.value === condition.includes)
        : source.type === 'yes_no'
          ? typeof condition.equals === 'boolean'
          : (source.type === 'single_choice' || source.type === 'dropdown') &&
            source.options.some((option) => option.value === condition.equals);
    const choice = ['single_choice', 'dropdown', 'multiple_choice', 'yes_no'].includes(source.type);
    if (!valid) problems.push({ path: at, message: choice ? m.conditionValue : m.conditionType });
    else sources.push(source);
  });
  return sources;
}

function fieldProblems(field: FormField, path: Path): Problem[] {
  const problems: Problem[] = [];
  const add = (key: string, message: string) => problems.push({ path: [...path, key], message });
  if ('options' in field) {
    const values = field.options.map((option) => option.value);
    if (new Set(values).size !== values.length) add('options', m.optionsUnique);
  }
  if ('eligibility' in field && field.eligibility !== undefined) {
    if (!field.required) add('required', m.eligibilityRequired);
    if (!canSee(field, 'staff')) add('audiences', m.eligibilityStaff);
    if (field.type === 'single_choice') {
      const stops = field.eligibility.stopValues;
      const values = field.options.map((option) => option.value);
      if (!stops.every((value) => values.includes(value))) add('eligibility', m.eligibilityValues);
      else if (values.every((value) => stops.includes(value))) add('eligibility', m.eligibilityAll);
    }
  }
  if (field.type === 'number' && field.min !== undefined && field.max !== undefined) {
    if (field.min > field.max) add('min', m.limitOrder);
  }
  if (
    field.type === 'currency' &&
    field.maxMinor !== undefined &&
    field.minMinor > field.maxMinor
  ) {
    add('minMinor', m.limitOrder);
  }
  if (field.type === 'multiple_choice') {
    const { minSelections = 0, maxSelections = field.options.length } = field;
    if (minSelections > maxSelections) add('minSelections', m.limitOrder);
    if (maxSelections > field.options.length) add('maxSelections', m.selectionsOptions);
  }
  return problems;
}

/** Everything wrong between a definition's parts, with where it is. */
export function definitionProblems(definition: DefinitionShape): Problem[] {
  const problems: Problem[] = [];
  const ids = new Set<string>();
  const earlier = new Map<string, FormField>();
  const useId = (id: string, path: Path) => {
    if (ids.has(id)) problems.push({ path: [...path, 'id'], message: m.idUsedTwice });
    ids.add(id);
  };
  definition.sections.forEach((section, s) => {
    const at = ['sections', s];
    useId(section.id, at);
    const sectionSources = conditionSources(
      section.conditions,
      earlier,
      [...at, 'conditions'],
      problems,
    );
    section.fields.forEach((field, f) => {
      const here = [...at, 'fields', f];
      useId(field.id, here);
      const fieldSources = conditionSources(
        field.conditions,
        earlier,
        [...here, 'conditions'],
        problems,
      );
      for (const source of [...sectionSources, ...fieldSources]) {
        if (projectionAudiences.some((who) => canSee(field, who) && !canSee(source, who))) {
          problems.push({ path: [...here, 'conditions'], message: m.conditionReveals });
        }
      }
      problems.push(...fieldProblems(field, here));
      earlier.set(field.id, field);
    });
  });
  if (fieldsOf(definition).length > MAX_FIELDS) {
    problems.push({ path: ['sections'], message: m.tooManyFields });
  }
  return problems;
}

/** A whole definition: its shape, then the rules between its parts. */
export const formDefinitionSchema = definitionShapeSchema.superRefine((definition, context) => {
  for (const problem of definitionProblems(definition)) {
    context.addIssue({
      code: 'custom',
      path: problem.path,
      message: problem.message,
      params: catalogueParams,
    });
  }
});

export type FormDefinition = z.output<typeof formDefinitionSchema>;

export function parseDefinition(input: unknown) {
  return formDefinitionSchema.safeParse(input);
}

/**
 * Field ids that a new version gives another type, against the latest of the
 * earlier versions (in order) that had each id. An id always means the same
 * question, so publishing refuses a version with any.
 */
export function changedFieldTypes(
  earlier: readonly FormDefinition[],
  next: FormDefinition,
): string[] {
  const types = new Map<string, string>();
  for (const version of earlier) {
    for (const field of fieldsOf(version)) types.set(field.id, field.type);
  }
  return fieldsOf(next)
    .filter((field) => types.has(field.id) && types.get(field.id) !== field.type)
    .map((field) => field.id);
}
