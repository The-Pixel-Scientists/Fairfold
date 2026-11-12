// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grants module's contribution to subject access (ADR 0016, ADR 0027):
// the person's applications, the decision emails and message notifications sent to
// them, the messages on their applications (bodies included, as the person is
// owed them), and every
// table that joins to an application by its subject path (eligibility
// results, the first stage entry, file links and released decisions), each
// classified column keyed by its field id with its sensitivity. Scores,
// assignments (which name reviewers and show review progress), unreleased
// decisions and how far an application has moved stay out until a check
// before release exists (rule 8; `withheld` says which and why). Each answer
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

/** Rows are read only where `column` is (or is not) null. */
type RowFilter = readonly [column: string, 'is' | 'is not'];

const internal = (...names: string[]): Columns => names.map((name) => [name, 'internal']);

const created = internal('tenant_id', 'id', 'created_at', 'created_by');

const keyAndActors = [...created, ...internal('updated_at', 'updated_by')];

/**
 * Each table, its classified columns but for those in `withheld` (and an
 * application's `answers`, read apart, field by field), its subject path:
 * the column that holds the person's party id, or, with a `parent`, the
 * column that joins to it, and a filter on the rows read.
 */
export const subjectTables: Readonly<
  Record<string, { column: string; parent?: string; columns: Columns; only?: RowFilter }>
> = {
  'grants.application': {
    column: 'applicant_person_id',
    columns: [
      ...created,
      ...internal(
        'round_id',
        'form_version_id',
        'applicant_person_id',
        'organisation_id',
        'status',
        'answers_version',
        'submitted_at',
        'submitted_late',
        'withdrawn_at',
        'organisation_snapshot_id',
        'submission_route',
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
  'grants.message_notification': {
    column: 'recipient_person_id',
    columns: [
      ...internal('tenant_id', 'id', 'message_id'),
      ['recipient_person_id', 'personal'],
      ...internal('template_version_id', 'status', 'error_code', 'sent_at', 'created_at'),
    ],
  },
  'grants.application_message': {
    column: 'application_id',
    parent: 'grants.application',
    columns: internal('tenant_id', 'id', 'application_id', 'thread_id', 'created_at'),
  },
  'grants.reminder_email': {
    column: 'recipient_person_id',
    only: ['assignment_id', 'is'],
    columns: internal(
      'tenant_id',
      'id',
      'kind',
      'application_id',
      'recipient_person_id',
      'template_version_id',
      'occurrence',
      'status',
      'outcome_code',
      'attempts',
      'last_attempt_at',
      'sent_at',
      'created_at',
    ),
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
    only: ['from_stage_id', 'is'],
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
  'grants.decision': {
    column: 'application_id',
    parent: 'grants.application',
    only: ['released_at', 'is not'],
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

/**
 * The platform's messages (ADR 0030), read by the thread ids an application's join table holds,
 * since their own rows name no applicant: the `from` column of each `through` row is the
 * record's `column`.
 */
export const linkedTables: Readonly<
  Record<string, { through: string; from: string; column: string; columns: Columns }>
> = {
  'app.message': {
    through: 'grants.application_message',
    from: 'thread_id',
    column: 'thread_id',
    columns: [
      ...internal('tenant_id', 'id', 'thread_id', 'side'),
      ['body', 'personal'],
      ...internal('author_membership_id', 'author_person_id', 'created_at'),
    ],
  },
};

/**
 * What a subject access export leaves out until a check before release
 * exists (rule 8: decisions are private until released), in plain words, by
 * table, column and rows.
 */
export const withheld = {
  tables: {
    'grants.score': 'Scores and comments stay private until a check before release exists.',
    'grants.assignment':
      'Who reviews an application, and how far their reviews have gone, stays private. The row can name the reviewer and show how far the application has moved.',
    'grants.application_note':
      'Staff notes about an application are not yet read for export: the export job cannot read them until the database grants it.',
    'grants.application_owner': 'Who owns an application is staff triage and names a staff member.',
    'grants.application_label':
      'Labels on an application are staff triage, not shown to applicants.',
    'grants.adjustment':
      'Its reason codes are not shown to applicants, and it is about the organisation, not the person.',
    'grants.monitoring_response':
      'Monitoring responses are a separate output (ADR 0032), not part of this export.',
  },
  columns: {
    'grants.reminder_email.assignment_id':
      'It names a review assignment, which shows who reviews an application.',
    'grants.application.submitted_by':
      'It names the staff member who submitted the application for the applicant.',
    'grants.application.stage_id':
      'It shows how far the application has moved, which applicants are not told.',
    'grants.application.updated_at':
      'Once an application is submitted, a later change date shows that staff have moved it on, and when.',
    'grants.application.updated_by':
      'Once an application is submitted, it names the staff member who moved it on.',
  },
  rows: {
    'grants.reminder_email':
      'Only reminders about a draft are included. Overdue review reminders show who reviews an application.',
    'grants.decision': 'A decision is included only once it has been released.',
    'grants.stage_transition':
      'Only the move into the first stage is included. Later moves show how far the application has gone.',
  },
} as const;

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
  only?: RowFilter,
): Promise<StoredRow[]> {
  if (values.length === 0) return Promise.resolve([]);
  const read = columns.map(([name]) => name);
  const query = tx
    .$extendTables<Tables>()
    .selectFrom(table)
    .select(table === 'grants.application' ? [...read, 'answers'] : read)
    .where(column, 'in', values);
  return (only === undefined ? query : query.where(only[0], only[1], null)).orderBy('id').execute();
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
    const read: Record<string, StoredRow[]> = {};
    for (const [table, { column, parent, columns, only }] of Object.entries(subjectTables)) {
      const rows = await rowsOf(
        tx,
        table,
        column,
        columns,
        parent === undefined
          ? [subjectPartyId]
          : (read[parent] ?? []).map((row) => String(row['id'])),
        only,
      );
      read[table] = rows;
      data[table] =
        table === 'grants.application'
          ? await withAnswers(tx, columns, rows)
          : rows.map((row) => toRow(table, columns, row));
    }
    for (const [table, { through, from, column, columns }] of Object.entries(linkedTables)) {
      const rows = await rowsOf(
        tx,
        table,
        column,
        columns,
        (read[through] ?? []).map((row) => String(row[from])),
      );
      data[table] = rows.map((row) => toRow(table, columns, row));
    }
    return data;
  },
};
