// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What forms may send the warehouse (ADR 0016, ADR 0032): answer values only
// where the pinned version classifies the question public or internal, and
// never an aggregate-only, file or personal one. Respondent ids, spam
// reasons and token data are not answers and never pass through here. Every
// classification has a rule, so adding one without deciding fails to compile
// and fails the test beside this file.

import {
  questionsOf,
  visibleFields,
  classificationOf,
  type Answers,
  type Classification,
  type FormDefinition,
} from '@pixel-scientists/domain/forms';

export const warehouseClassifications = {
  public: true,
  internal: true,
  personal: false,
  special_category: false,
} as const satisfies Record<Classification, boolean>;

/**
 * The answers to questions shown for these answers that may leave, by field
 * id. Anything the definition does not ask is dropped, as is anything a
 * response holds that is not an answer.
 */
export function warehouseAnswers(definition: FormDefinition, answers: Answers): Answers {
  const allowed = new Set(
    questionsOf(definition)
      .filter(
        (question) =>
          warehouseClassifications[classificationOf(question)] &&
          question.audiences !== 'aggregate_only' &&
          question.type !== 'file',
      )
      .map((question) => question.id),
  );
  const kept: Record<string, unknown> = {};
  for (const field of visibleFields(definition, answers)) {
    if (allowed.has(field.id) && Object.hasOwn(answers, field.id))
      kept[field.id] = answers[field.id];
  }
  return kept;
}
