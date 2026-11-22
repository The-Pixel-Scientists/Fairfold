// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The assure module's contribution to subject access (ADR 0016, ADR 0027,
// ADR 0031): the subject's rows in every assure table, reached through the
// subject paths of the classification map, each classified column keyed by
// its field id with its sensitivity. That is the organisation's lookup
// snapshots, the officer rows linked to the person, screening runs and
// matches (with their decisions) about them, checklist answers on their
// applications, visits and attendance. The column lists copy the
// classification map, which a module may not import; a test keeps them in
// step, and the platform checks every cell against the map again. Read in
// the caller's transaction, so row-level security leaves out any other
// tenant, and whether or not the tenant has the module switched on.

import type {
  SubjectData,
  SubjectDataContribution,
  SubjectDataRow,
} from '@pixel-scientists/domain/platform/subject-access';

import type { Tx } from './registries/store.ts';

type Cell = SubjectDataRow[string];
type Columns = readonly (readonly [string, Cell['sensitivity']])[];

const internal = (...names: string[]): Columns => names.map((name) => [name, 'internal']);
const personal = (...names: string[]): Columns => names.map((name) => [name, 'personal']);

/**
 * Each table, its classified columns, and its subject path: the column that
 * holds the party id, or, with a `parent`, the column that joins to the
 * parent's rows. An application is the parent of checklist answers, and is
 * read for its id alone.
 */
export const subjectTables: Readonly<
  Record<string, { column: string; parent?: string; columns: Columns }>
> = {
  'assure.lookup_snapshot': {
    column: 'organisation_id',
    columns: [
      ...internal(
        'tenant_id',
        'id',
        'organisation_id',
        'registry',
        'scheme',
        'identifier',
        'outcome',
        'list_id',
        'registry_status',
        'registered_name',
        'registered_on',
        'removed_on',
        'accounts_period_end',
        'income_minor',
        'income_currency',
        'expenditure_minor',
        'expenditure_currency',
        'accounts_overdue',
        'fetched_at',
      ),
      ...personal(
        'address_line1',
        'address_line2',
        'address_town',
        'address_postcode',
        'address_country_code',
      ),
    ],
  },
  'assure.lookup_officer': {
    column: 'person_id',
    columns: [
      ...internal(
        'tenant_id',
        'id',
        'snapshot_id',
        'role',
        'person_id',
        'linked_by',
        'linked_at',
        'created_at',
      ),
      ...personal('name'),
    ],
  },
  'assure.screening_run': {
    column: 'party_id',
    columns: internal(
      'tenant_id',
      'id',
      'party_id',
      'trigger',
      'status',
      'list_id',
      'list_last_checked_at',
      'threshold',
      'names_screened',
      'matches_raised',
      'error_code',
      'requested_by',
      'completed_at',
      'created_at',
      'updated_at',
    ),
  },
  'assure.screening_match': {
    column: 'subject_party_id',
    columns: [
      ...internal(
        'tenant_id',
        'id',
        'run_id',
        'party_id',
        'name_source',
        'officer_id',
        'subject_party_id',
        'list_id',
        'designation_id',
        'entry_kind',
        'regime',
        'designated_on',
        'country',
        'similarity',
        'created_at',
      ),
      ...personal('screened_name', 'entry_name', 'dates_of_birth', 'nationalities'),
    ],
  },
  'assure.match_decision': {
    column: 'match_id',
    parent: 'assure.screening_match',
    columns: internal(
      'tenant_id',
      'id',
      'match_id',
      'outcome',
      'reason_code',
      'decided_by',
      'decided_at',
    ),
  },
  'assure.checklist_response': {
    column: 'application_id',
    parent: 'grants.application',
    columns: [
      ...internal(
        'tenant_id',
        'id',
        'application_id',
        'checklist_id',
        'checklist_version_id',
        'saved_by',
        'created_at',
        'updated_at',
      ),
      ...personal('answers'),
    ],
  },
  'assure.checklist_response_file': {
    column: 'response_id',
    parent: 'assure.checklist_response',
    columns: [
      ...internal('tenant_id', 'id', 'response_id', 'item_id', 'created_by', 'created_at'),
      ...personal('file_id'),
    ],
  },
  'assure.monitoring_visit': {
    column: 'organisation_id',
    columns: [
      ...internal(
        'tenant_id',
        'id',
        'organisation_id',
        'application_id',
        'visited_on',
        'visit_type',
        'recorded_by',
        'updated_by',
        'created_at',
        'updated_at',
      ),
      ...personal('findings', 'follow_ups'),
    ],
  },
  'assure.visit_attendee': {
    column: 'person_id',
    columns: [...internal('tenant_id', 'id', 'visit_id', 'created_at'), ...personal('person_id')],
  },
  'assure.visit_evidence': {
    column: 'visit_id',
    parent: 'assure.monitoring_visit',
    columns: [
      ...internal('tenant_id', 'id', 'visit_id', 'added_by', 'created_at'),
      ...personal('file_id', 'caption'),
    ],
  },
};

/** Columns of type `date`, which the driver reads as a local midnight. */
const dateColumns: ReadonlySet<string> = new Set([
  'assure.lookup_snapshot.registered_on',
  'assure.lookup_snapshot.removed_on',
  'assure.lookup_snapshot.accounts_period_end',
  'assure.screening_match.designated_on',
  'assure.monitoring_visit.visited_on',
]);

type Tables = Record<string, Record<string, unknown>>;
type StoredRow = Record<string, unknown>;

/** The cell for a stored value; a timestamp is its ISO text, a date its own day. */
function cellValue(field: string, value: unknown): Cell['value'] {
  if (value instanceof Date) {
    if (!dateColumns.has(field)) return value.toISOString();
    const two = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`;
  }
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
  return tx
    .$extendTables<Tables>()
    .selectFrom(table)
    .select(columns.map(([name]) => name))
    .where(column, 'in', values)
    .orderBy('id')
    .execute();
}

export const assureSubjectData: SubjectDataContribution<'assure', Tx> = {
  module: 'assure',
  async subjectData(tx, subjectPartyId) {
    const data: SubjectData = {};
    const read: Record<string, StoredRow[]> = {
      'grants.application': await rowsOf(
        tx,
        'grants.application',
        'applicant_person_id',
        internal('id'),
        [subjectPartyId],
      ),
    };
    for (const [table, { column, parent, columns }] of Object.entries(subjectTables)) {
      const rows = await rowsOf(
        tx,
        table,
        column,
        columns,
        parent === undefined
          ? [subjectPartyId]
          : (read[parent] ?? []).map((row) => String(row['id'])),
      );
      read[table] = rows;
      data[table] = rows.map((row) =>
        Object.fromEntries(
          columns.map(([name, sensitivity]) => [
            `${table}.${name}`,
            { value: cellValue(`${table}.${name}`, row[name]), sensitivity },
          ]),
        ),
      );
    }
    return data;
  },
};
