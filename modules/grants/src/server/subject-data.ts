// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's contribution to subject access (ADR 0016, ADR 0027):
// the person's applications and the decision emails sent to them, and every
// table that joins to an application by its subject path (eligibility
// results, stage moves, file links, assignments, scores and decisions), each
// classified column keyed by its field id with its sensitivity. Each answer
// is its own cell keyed by its stable field id (rule 7) with the class its
// question has in the form version the application pinned; an answer that
// version does not ask is left out. The column lists below copy the
// classification map, which a module may not import; a test keeps them in
// step, and the platform checks every cell against the map again. Read in
// the caller's transaction, so row-level security leaves out any other
// tenant, and whether or not the tenant has the module switched on.

import { classifyAnswers, pinnedDefinitions } from '@pixel-scientists/db';
import type { Answers } from '@pixel-scientists/domain/forms';
import type {
  SubjectData,
  SubjectDataContribution,
  SubjectDataRow,
} from '@pixel-scientists/domain/platform/subject-access';

import type { Tx } from './programme/tables.ts';

type Cell = SubjectDataRow[string];
type Sensitivity = Cell['sensitivity'];
type Columns = readonly (readonly [string, Sensitivity])[];

const internal = (...names: string[]): Columns => names.map((name) => [name, 'internal']);

const keyAndActors = internal(
  'tenant_id',
  'id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
);

/**
 * Each table, its classified columns (but for an application's `answers`,
 * read apart, field by field), and its subject path: the column that holds
 * the person's party id, or, with a `parent`, the column that joins to it.
 */
export const subjectTables: Readonly<
  Record<string, { column: string; parent?: string; columns: Columns }>
> = {
  'grants.application': {
    column: 'applicant_person_id',
    columns: [
      ...keyAndActors,
      ...internal(
        'round_id',
        'form_version_id',
        'applicant_person_id',
        'organisation_id',
        'status',
        'answers_version',
        'stage_id',
        'submitted_at',
        'submitted_late',
        'withdrawn_at',
        'organisation_snapshot_id',
      ),
    ],
  },
  'grants.decision_email': {
    column: 'recipient_person_id',
    columns: [
      ...keyAndActors,
      ...internal(
        'decision_id',
        'recipient_person_id',
        'template_version_id',
        'status',
        'error_code',
        'attempts',
        'last_attempt_at',
        'sent_at',
      ),
    ],
  },
  'grants.eligibility_result': {
    column: 'application_id',
    parent: 'grants.application',
    columns: internal(
      'tenant_id',
      'id',
      'application_id',
      'form_version_id',
      'outcome',
      'stopping_field_id',
      'checked_at',
      'checked_by',
    ),
  },
  'grants.stage_transition': {
    column: 'application_id',
    parent: 'grants.application',
    columns: internal(
      'tenant_id',
      'id',
      'round_id',
      'application_id',
      'from_stage_id',
      'to_stage_id',
      'moved_at',
      'moved_by',
    ),
  },
  'grants.application_file': {
    column: 'application_id',
    parent: 'grants.application',
    columns: internal(
      'tenant_id',
      'id',
      'application_id',
      'file_id',
      'field_id',
      'created_by',
      'created_at',
    ),
  },
  'grants.assignment': {
    column: 'application_id',
    parent: 'grants.application',
    columns: [
      ...keyAndActors,
      ...internal(
        'round_id',
        'application_id',
        'reviewer_membership_id',
        'stage_id',
        'status',
        'submitted_at',
      ),
    ],
  },
  'grants.score': {
    column: 'assignment_id',
    parent: 'grants.assignment',
    columns: [
      ...keyAndActors,
      ...internal('assignment_id', 'stage_id', 'criterion_id', 'score'),
      ['comment', 'personal'],
    ],
  },
  'grants.decision': {
    column: 'application_id',
    parent: 'grants.application',
    columns: [
      ...keyAndActors,
      ...internal(
        'application_id',
        'outcome',
        'amount_minor',
        'currency',
        'recorded_at',
        'recorded_by',
        'released_at',
        'released_by',
      ),
    ],
  },
};

type Tables = Record<string, Record<string, unknown>>;
type StoredRow = Record<string, unknown>;

/** The cell for a stored value; a timestamp is its ISO text. */
function cellValue(value: unknown): Cell['value'] {
  if (value instanceof Date) return value.toISOString();
  // The driver reads these tables' other columns as strings, numbers, booleans or JSON.
  return (value ?? null) as Cell['value'];
}

function rowsOf(
  tx: Tx,
  table: string,
  column: string,
  columns: Columns,
  values: readonly string[],
): Promise<StoredRow[]> {
  if (values.length === 0) return Promise.resolve([]);
  const read = columns.map(([name]) => name);
  return tx
    .$extendTables<Tables>()
    .selectFrom(table)
    .select(table === 'grants.application' ? [...read, 'answers'] : read)
    .where(column, 'in', values)
    .orderBy('id')
    .execute();
}

const toRow = (table: string, columns: Columns, row: StoredRow): SubjectDataRow =>
  Object.fromEntries(
    columns.map(([column, sensitivity]) => [
      `${table}.${column}`,
      { value: cellValue(row[column]), sensitivity },
    ]),
  );

/** Applications with each answer as a cell under its field id, classed by the pinned version. */
async function withAnswers(tx: Tx, columns: Columns, rows: StoredRow[]): Promise<SubjectDataRow[]> {
  const definitions = await pinnedDefinitions(
    tx,
    rows.map((row) => String(row['id'])),
  );
  return rows.map((row) => {
    const definition = definitions.get(String(row['id']));
    const answers = definition ? classifyAnswers(definition, row['answers'] as Answers) : {};
    return {
      ...toRow('grants.application', columns, row),
      ...Object.fromEntries(
        Object.entries(answers).flatMap(([id, answer]) =>
          'value' in answer
            ? [[id, { value: cellValue(answer.value), sensitivity: answer.classification }]]
            : [],
        ),
      ),
    };
  });
}

export const grantsSubjectData: SubjectDataContribution<'grants', Tx> = {
  module: 'grants',
  async subjectData(tx, subjectPartyId) {
    const data: SubjectData = {};
    const ids: Record<string, string[]> = {};
    for (const [table, { column, parent, columns }] of Object.entries(subjectTables)) {
      const rows = await rowsOf(
        tx,
        table,
        column,
        columns,
        parent === undefined ? [subjectPartyId] : (ids[parent] ?? []),
      );
      ids[table] = rows.map((row) => String(row['id']));
      data[table] =
        table === 'grants.application'
          ? await withAnswers(tx, columns, rows)
          : rows.map((row) => toRow(table, columns, row));
    }
    return data;
  },
};
