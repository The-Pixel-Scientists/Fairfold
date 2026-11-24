// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's contributions to erasure and subject access (ADR 0016,
// ADR 0027), for the responses a signed-in person made. Both run in the
// caller's transaction, so row-level security leaves out any other tenant, and
// whether or not forms is switched on for it. An anonymous response holds no
// party and is never reached: its token is the only link to it.
//
// Erasure clears, through `forms.erase_subject()`, every answer the pinned
// version does not classify public or internal, and deletes nothing. A party
// this tenant does not have is skipped. Subject access gives each response
// the person made, drafts included, with its columns classed by the
// classification map and each answer under its field id, classed by the
// version the response pinned.

import { classifyAnswers, type Transaction } from '@pixel-scientists/db';
import { classification } from '@pixel-scientists/db/classification';
import { parseDefinition, type Answers } from '@pixel-scientists/domain/forms';
import type {
  ErasureContribution,
  SubjectData,
  SubjectDataContribution,
  SubjectDataRow,
} from '@pixel-scientists/domain/platform/subject-access';
import { partyErasureTarget } from '@pixel-scientists/party/server';

type Tx = Transaction<unknown>;

const TABLE = 'forms.response';

/** The columns a person's response gives them: everything but the anonymous route's hashes, which a signed-in response has none of. */
const COLUMNS = [
  'tenant_id',
  'id',
  'form_id',
  'form_version_id',
  'route',
  'respondent_person_id',
  'status',
  'submitted_at',
  'retain_until',
  'spam_reason',
  'spam_marked_by',
  'spam_marked_at',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
] as const;

export const formsErasure: ErasureContribution<'forms', Tx> = {
  module: 'forms',
  async erase(tx, subjects) {
    let responses = 0;
    for (const { partyId } of subjects) {
      if ((await partyErasureTarget(tx, partyId)) === null) continue;
      const { counts } = await tx
        .selectNoFrom((eb) =>
          eb.fn<Record<string, number>>('forms.erase_subject', [eb.val(partyId)]).as('counts'),
        )
        .executeTakeFirstOrThrow();
      responses += counts[TABLE] ?? 0;
    }
    return { [TABLE]: responses };
  },
};

type Stored = Record<string, unknown> & { definition: unknown; answers: unknown };

/** The cell for a stored value; a timestamp is its ISO text. */
const cellValue = (value: unknown) =>
  (value instanceof Date
    ? value.toISOString()
    : (value ?? null)) as SubjectDataRow[string]['value'];

export const formsSubjectData: SubjectDataContribution<'forms', Tx> = {
  module: 'forms',
  async subjectData(tx, subjectPartyId) {
    const rows = (await tx
      .$extendTables<{
        'forms.response': Record<string, unknown>;
        'forms.form_version': Record<string, unknown>;
      }>()
      .selectFrom('forms.response as r')
      .innerJoin('forms.form_version as v', 'v.id', 'r.form_version_id')
      .select([
        ...COLUMNS.map((column) => `r.${column} as ${column}` as const),
        'v.definition as definition',
        'r.answers as answers',
      ])
      .where('r.respondent_person_id', '=', subjectPartyId)
      .orderBy('r.id')
      .execute()) as Stored[];
    const data: SubjectData = {
      [TABLE]: rows.map((row) => {
        const definition = parseDefinition(row.definition);
        if (!definition.success) throw new Error('A response has no readable pinned form version.');
        const answers = classifyAnswers(definition.data, row.answers as Answers);
        return {
          ...Object.fromEntries(
            COLUMNS.map((column) => [
              `${TABLE}.${column}`,
              {
                value: cellValue(row[column]),
                sensitivity: classification[TABLE]?.[column]?.sensitivity ?? 'personal',
              },
            ]),
          ),
          ...Object.fromEntries(
            Object.entries(answers).flatMap(([id, answer]) =>
              'value' in answer
                ? [[id, { value: cellValue(answer.value), sensitivity: answer.classification }]]
                : [],
            ),
          ),
        };
      }),
    };
    return data;
  },
};
