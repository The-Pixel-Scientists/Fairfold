// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Answers in a response (ADR 0004): the one exception to the rule that a
// response schema has no union of objects, lists and plain values, since an
// answer can be any of them. A response carries answers only through the
// schema for its audience here, and the only way to fill one is
// projectedAnswers(), which builds the projection from the application's
// pinned form version. Each audience's answers have their own type, so a
// handler cannot send the applicant's projection, which keeps aggregate-only
// answers, in a staff response. The route rules (json-schema.ts) know these
// schemas by identity, so no other schema can claim the exception: use one
// as it is, since a copy is refused.

import type { z } from 'zod';

import { answersSchema } from '../../forms/answers.ts';
import { projectionAudiences, type ProjectionAudience } from '../../forms/audience.ts';
import { projectAnswers } from '../../forms/project.ts';
import type { FormDefinition } from '../../forms/rules.ts';
import type { Answers } from '../../forms/visibility.ts';

const readers: Record<ProjectionAudience, string> = {
  applicant: 'the applicant',
  staff: 'staff',
  reviewer: 'reviewers',
  blind_reviewer: 'blind reviewers',
};

function schemaFor<const A extends ProjectionAudience>(audience: A) {
  return answersSchema
    .describe(
      `Answers by field id, as ${readers[audience]} may see them on the pinned form version.`,
    )
    .brand<`answers for ${A}`>();
}

/** A response's answers, by the audience they were projected for. */
export const projectedAnswersSchemas = {
  applicant: schemaFor('applicant'),
  staff: schemaFor('staff'),
  reviewer: schemaFor('reviewer'),
  blind_reviewer: schemaFor('blind_reviewer'),
} as const satisfies Record<ProjectionAudience, z.ZodType>;

export type ProjectedAnswers<A extends ProjectionAudience> = z.output<
  (typeof projectedAnswersSchemas)[A]
>;

const exceptions: ReadonlySet<z.ZodType> = new Set(
  projectionAudiences.map((audience) => projectedAnswersSchemas[audience]),
);

/** Whether a schema is one of the projected answers schemas above, and not a copy of one. */
export function isProjectedAnswersSchema(schema: unknown): boolean {
  return exceptions.has(schema as z.ZodType);
}

/**
 * The answers `audience` may see, from the stored answers and the definition
 * of the form version the application pinned. The response encodes them
 * through its schema, which checks each value is an answer.
 */
export function projectedAnswers<const A extends ProjectionAudience>(
  definition: FormDefinition,
  answers: Answers,
  audience: A,
): ProjectedAnswers<A> {
  return projectAnswers(definition, answers, audience) as ProjectedAnswers<A>;
}
