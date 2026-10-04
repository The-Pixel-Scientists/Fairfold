// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The answers one audience may see (ADR 0004, blind review). The result is a
// new object built from the pinned definition: a field's answer is copied in,
// by id, only when the field is shown for these answers and the audience may
// see it. Nothing else in the stored answers can pass through, so staff and
// reviewers never get aggregate-only answers, blind reviewers never get
// identity fields, and an unknown audience gets nothing.

import { canSee, type ProjectionAudience } from './audience.ts';
import type { FormDefinition } from './rules.ts';
import { visibleFields, type Answers } from './visibility.ts';

export function projectAnswers(
  definition: FormDefinition,
  answers: Answers,
  audience: ProjectionAudience,
): Answers {
  const projected: Record<string, unknown> = {};
  for (const field of visibleFields(definition, answers)) {
    if (field.type === 'content' || !canSee(field, audience)) continue;
    if (Object.hasOwn(answers, field.id)) projected[field.id] = answers[field.id];
  }
  return projected;
}
