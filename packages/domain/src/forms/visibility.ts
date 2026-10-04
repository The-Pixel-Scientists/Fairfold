// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which fields the applicant is shown, given their answers so far. A field
// shows when its section's conditions and its own all hold. Conditions read
// only earlier questions, so one pass in order settles every field, and an
// answer to a field that is not shown counts as no answer.

import type { Condition, FormField } from './definition.ts';
import type { FormDefinition } from './rules.ts';

/** Answers keyed by field id, as an application holds them. */
export type Answers = Readonly<Record<string, unknown>>;

function holds(condition: Condition, shown: ReadonlyMap<string, unknown>): boolean {
  const answer = shown.get(condition.field);
  if ('includes' in condition) {
    return Array.isArray(answer) && (answer as unknown[]).includes(condition.includes);
  }
  return answer === condition.equals;
}

/** The fields shown for these answers, in order, content blocks included. */
export function visibleFields(definition: FormDefinition, answers: Answers): FormField[] {
  const shown = new Map<string, unknown>();
  const visible: FormField[] = [];
  for (const section of definition.sections) {
    if (!section.conditions.every((condition) => holds(condition, shown))) continue;
    for (const field of section.fields) {
      if (!field.conditions.every((condition) => holds(condition, shown))) continue;
      visible.push(field);
      if (Object.hasOwn(answers, field.id)) shown.set(field.id, answers[field.id]);
    }
  }
  return visible;
}
