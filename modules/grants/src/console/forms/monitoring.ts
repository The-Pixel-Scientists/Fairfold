// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The equality monitoring form as the builder handles it. The questions come
// from the fixed set in the contracts, so a funder chooses which to ask and
// in what order, and the contracts' check says what stops a draft being a
// round's monitoring form.

import type { FormDefinition } from '@pixel-scientists/domain/forms';

import {
  monitoringDefinitionProblems,
  monitoringQuestions,
  monitoringTemplate,
} from '../../contracts/index.ts';

/** A problem with a question, or with the form as a whole when `fieldId` is null. */
export interface MonitoringIssue {
  fieldId: string | null;
  message: string;
}

export const NO_QUESTIONS = 'Choose at least one question to ask.';

/** The draft's own questions when it already asks only monitoring questions, otherwise the starting template. */
export function monitoringStart(definition: FormDefinition | null): FormDefinition {
  const fields = definition?.sections.flatMap((section) => section.fields) ?? [];
  const ours = fields.length > 0 && fields.every((field) => monitoringQuestions.has(field.id));
  return definition !== null && ours ? definition : monitoringTemplate();
}

/** The ids of the questions the form asks, in order. */
export const askedIds = (definition: FormDefinition): string[] =>
  definition.sections.flatMap((section) => section.fields.map((field) => field.id));

/** The template's section holding these questions of the set, in this order. */
export function withQuestions(ids: readonly string[]): FormDefinition {
  const [section] = monitoringTemplate().sections;
  const fields = ids.flatMap((id) => {
    const question = monitoringQuestions.get(id);
    return question === undefined ? [] : [structuredClone(question)];
  });
  return { sections: section === undefined ? [] : [{ ...section, fields }] };
}

/** Everything that stops the draft being a monitoring form, with the question each concerns. */
export function monitoringIssues(definition: FormDefinition): MonitoringIssue[] {
  const fields = definition.sections.flatMap((section) => section.fields);
  if (fields.length === 0) return [{ fieldId: null, message: NO_QUESTIONS }];
  return monitoringDefinitionProblems(definition).flatMap(({ path, message }) => {
    const [s, f] = [path[1], path[3]];
    const field =
      typeof s === 'number' && typeof f === 'number'
        ? definition.sections[s]?.fields[f]
        : undefined;
    return [{ fieldId: field?.id ?? null, message }];
  });
}
