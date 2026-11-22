// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Why the server refused to publish, placed on the draft. The server names
// fields by id (`f_…`, or `f_….c_…` for a table column); the builder places a
// problem by position, so each id is looked up in the draft being published.

import type { FormDefinition } from '@pixel-scientists/domain/forms';
import { asProblem } from '@pixel-scientists/ui';
import { refusedProblems } from '@pixel-scientists/ui/form-builder';
import type { Problem } from '@pixel-scientists/ui/form-builder';

import { formsMessages as words } from '../../contracts/index.ts';

/** The part of a question each refusal is about, so the problem shows beside its box. */
const parts = new Map<string, string>([
  [words.typeChanged, 'type'],
  [words.classificationLowered, 'classification'],
  [words.anonymousFile, 'type'],
  [words.anonymousAggregate, 'classification'],
]);

const FIELD = /(f_[^.\s]+)(?:\.(c_[^.\s]+))?/;

/** Each refusal in the server's words, at its question; a refusal naming no question of the draft has no place. */
export function publishRefusal(error: unknown, definition: FormDefinition): Problem[] {
  const found = asProblem(error);
  if (found === null || found.errors.length === 0) return refusedProblems(error);
  return found.errors.map(({ field, message }) => {
    const [, fieldId, columnId] = FIELD.exec(field) ?? [];
    const part = parts.get(message) ?? 'label';
    for (const [s, section] of definition.sections.entries()) {
      for (const [f, question] of section.fields.entries()) {
        if (question.id !== fieldId) continue;
        const at = ['sections', s, 'fields', f];
        const column =
          columnId === undefined || !('columns' in question)
            ? -1
            : question.columns.findIndex(({ id }) => id === columnId);
        return { path: column < 0 ? [...at, part] : [...at, 'columns', column, part], message };
      }
    }
    return { path: [], message };
  });
}
