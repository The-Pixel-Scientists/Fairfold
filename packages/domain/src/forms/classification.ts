// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How sensitive each answer is, field by field (ADR 0027, rule 5).
// Classification decides what leaves the system: subject access, erasure,
// export and the warehouse. Audiences decide who sees an answer in the app.
// ADR 0032 ties the two only for special category answers, which are
// aggregate only (rules.ts).

import {
  classifications,
  questionsOf,
  type Classification,
  type DefinitionShape,
  type Question,
} from './definition.ts';
import type { FormDefinition } from './rules.ts';
import { visibleFields, type Answers } from './visibility.ts';

const rank = (level: Classification): number => classifications.indexOf(level);

/**
 * The one reader of a question's classification. A version published before
 * classification existed has none, and gets a default that over-classifies:
 * special category for an aggregate-only question, personal for any other.
 */
export function classificationOf(field: Question): Classification {
  return (
    field.classification ?? (field.audiences === 'aggregate_only' ? 'special_category' : 'personal')
  );
}

/** Each question's classification, by field id. */
export function answerClassifications(definition: DefinitionShape): Record<string, Classification> {
  return Object.fromEntries(
    questionsOf(definition).map((field) => [field.id, classificationOf(field)]),
  );
}

/**
 * A new object holding only the answers to questions shown for these answers
 * and classified at or below `ceiling`, built like projectAnswers(): nothing
 * else in the stored answers passes through, and an unknown ceiling gets
 * nothing.
 */
export function answersUpTo(
  definition: FormDefinition,
  answers: Answers,
  ceiling: Classification,
): Answers {
  const kept: Record<string, unknown> = {};
  const highest = rank(ceiling);
  for (const field of visibleFields(definition, answers)) {
    if (field.type === 'content' || rank(classificationOf(field)) > highest) continue;
    if (Object.hasOwn(answers, field.id)) kept[field.id] = answers[field.id];
  }
  return kept;
}

/**
 * Field ids that a new version classifies lower than any earlier version
 * did. An id never becomes less protected, so publishing refuses a version
 * with any.
 */
export function loweredClassifications(
  earlier: readonly FormDefinition[],
  next: FormDefinition,
): string[] {
  const highest = new Map<string, number>();
  for (const version of earlier) {
    for (const field of questionsOf(version)) {
      highest.set(field.id, Math.max(highest.get(field.id) ?? -1, rank(classificationOf(field))));
    }
  }
  return questionsOf(next)
    .filter((field) => rank(classificationOf(field)) < (highest.get(field.id) ?? -1))
    .map((field) => field.id);
}
