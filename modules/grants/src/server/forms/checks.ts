// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the form routes check beyond the contract's schemas, and what they say
// when they refuse. Ids and types are the form engine's, so nothing here
// repeats an answer or any text a person typed.

import { changedFieldTypes, type FormDefinition } from '@pixel-scientists/domain/forms';
import {
  fieldForIssue,
  messageForIssue,
  type FieldProblem,
} from '@pixel-scientists/domain/platform';

import { formDefinitionInputSchema } from '../../contracts/index.ts';

export const formRefusals = {
  published:
    'This version is published, so it cannot be changed. Start a new draft to make changes.',
  alreadyPublished: 'This version is already published.',
  draftExists: 'This round already has a draft form. Open the draft, or discard it to start again.',
  changed: 'This draft changed while you were working on it. Reload it and try again.',
  nothingSaved:
    'This draft has no questions yet. Add a section with a question, save, then publish.',
  questionType: (id: string) =>
    `${id} was another type of question in an earlier version. Keep its type, or add a new question with a new id.`,
  columnType: (id: string) =>
    `${id} was another type of column in an earlier version. Keep its type, or add a new column with a new id.`,
} as const;

/**
 * The questions and columns whose ids an earlier published version used for
 * another type, each at the field that gives it the new type. `location`
 * names the definition in the request, such as `body.definition`.
 */
export function typeProblems(
  earlier: readonly FormDefinition[],
  next: FormDefinition,
  location: string,
): FieldProblem[] {
  const changed = new Set(changedFieldTypes(earlier, next));
  if (changed.size === 0) return [];
  return next.sections.flatMap((section, s) =>
    section.fields.flatMap((field, f) => {
      const at = `${location}.sections.${s}.fields.${f}`;
      const problems: FieldProblem[] = changed.has(field.id)
        ? [{ field: `${at}.type`, message: formRefusals.questionType(field.id) }]
        : [];
      if (field.type === 'table') {
        field.columns.forEach((column, c) => {
          if (changed.has(`${field.id}.${column.id}`)) {
            problems.push({
              field: `${at}.columns.${c}.type`,
              message: formRefusals.columnType(column.id),
            });
          }
        });
      }
      return problems;
    }),
  );
}

/** A stored definition checked again by the form engine and the contract's text rules. */
export function recheck(
  stored: unknown,
  location: string,
): { definition: FormDefinition } | { problems: FieldProblem[] } {
  const parsed = formDefinitionInputSchema.safeParse(stored);
  return parsed.success
    ? { definition: parsed.data }
    : {
        problems: parsed.error.issues.map((issue) => ({
          field: fieldForIssue(location, issue),
          message: messageForIssue(issue),
        })),
      };
}
