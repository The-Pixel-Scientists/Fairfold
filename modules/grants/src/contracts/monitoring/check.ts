// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The equality monitoring form rules (ADR 0032), on top of the form
// engine's own definitionProblems(). The console builder runs this before
// publishing, and the server again before a round may use the version as its
// monitoring form. Each problem names the field, as definitionProblems() does.

import {
  classificationOf,
  type FormDefinition,
  type FormField,
} from '@pixel-scientists/domain/forms';

import { monitoringMessages as m, type MonitoringMessage } from './messages.ts';
import { monitoringQuestions, preferNotToSay } from './questions.ts';

export interface MonitoringProblem {
  readonly path: (string | number)[];
  readonly message: MonitoringMessage;
}

/** JSON text with each object's keys sorted, so stored and parsed definitions compare alike. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  );
}

/** What is wrong with one field, before checking it against the question set. */
function ruleBroken(field: FormField): MonitoringMessage | null {
  if (field.type === 'content') return null;
  if (field.type === 'file') return m.fileQuestion;
  if (field.identity) return m.identityQuestion;
  if (field.audiences !== 'aggregate_only') return m.onlyInTotals;
  if (classificationOf(field) !== 'special_category') return m.specialCategory;
  if (field.required) return m.optional;
  if (
    'options' in field &&
    !field.options.some(
      (option) => option.value === preferNotToSay.value && option.label === preferNotToSay.label,
    )
  ) {
    return m.preferNotToSay;
  }
  return null;
}

/** Everything that stops a definition being a round's monitoring form. Empty when it may be one. */
export function monitoringDefinitionProblems(definition: FormDefinition): MonitoringProblem[] {
  const problems: MonitoringProblem[] = [];
  definition.sections.forEach((section, s) => {
    section.fields.forEach((field, f) => {
      const path = ['sections', s, 'fields', f];
      const known = monitoringQuestions.get(field.id);
      const message =
        ruleBroken(field) ??
        (known !== undefined && canonical(known) === canonical(field) ? null : m.fromQuestionSet);
      if (message !== null) problems.push({ path, message });
    });
  });
  return problems;
}
