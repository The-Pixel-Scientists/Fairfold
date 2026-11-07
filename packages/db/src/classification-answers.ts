// SPDX-License-Identifier: AGPL-3.0-or-later
//
// An application's answers, classified field by field (ADR 0027, "Form
// answers"). Each answer takes its question's class from the form version the
// application pinned (rule 7), read only through the form engine. These read
// and classify; they write nothing, so they record no audit event, and each
// caller audits its own read.

import {
  answerClassifications,
  answersUpTo,
  parseDefinition,
  type Answers,
  type Classification,
  type FormDefinition,
} from '@pixel-scientists/domain/forms';
import { sql, type Transaction } from 'kysely';

export interface ClassifiedAnswer {
  readonly classification: Classification;
  /** Left out for a key that is not a question in the pinned version. */
  readonly value?: unknown;
}

/**
 * Each stored answer's class, by field id, with its value. A key that is not
 * a question in `definition` is special category, and its value is dropped.
 */
export function classifyAnswers(
  definition: FormDefinition,
  answers: Answers,
): Record<string, ClassifiedAnswer> {
  const classes = answerClassifications(definition);
  return Object.fromEntries(
    Object.entries(answers).map(([id, value]) => {
      const classification = Object.hasOwn(classes, id) ? classes[id] : undefined;
      return [
        id,
        classification ? { classification, value } : { classification: 'special_category' },
      ];
    }),
  );
}

/** Only the answers classed at or below `ceiling`: the engine's own projection. */
export function answersAtOrBelow(
  definition: FormDefinition,
  answers: Answers,
  ceiling: Classification,
): Answers {
  return answersUpTo(definition, answers, ceiling);
}

const UNREADABLE = 'An application has no pinned form version that can be read.';

/**
 * The definition each application pinned, by application id, read in the
 * caller's tenant transaction, so ids that row-level security hides are left
 * out. Throws a message naming no value if a version is missing or does not
 * parse.
 */
export async function pinnedDefinitions<DB>(
  trx: Transaction<DB>,
  applicationIds: readonly string[],
): Promise<Map<string, FormDefinition>> {
  const { rows } = await sql<{ id: string; version: string; definition: unknown }>`
    SELECT a.id, a.form_version_id AS version, v.definition
      FROM grants.application a
      LEFT JOIN grants.form_version v
        ON v.tenant_id = a.tenant_id AND v.id = a.form_version_id
     WHERE a.id = ANY (${[...applicationIds]}::uuid[])
  `.execute(trx);
  const parsed = new Map<string, FormDefinition>();
  const definitions = new Map<string, FormDefinition>();
  for (const { id, version, definition } of rows) {
    let known = parsed.get(version);
    if (!known) {
      const result = parseDefinition(definition);
      if (!result.success) throw new Error(UNREADABLE);
      known = result.data;
      parsed.set(version, known);
    }
    definitions.set(id, known);
  }
  return definitions;
}
