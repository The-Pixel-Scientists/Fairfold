// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy module's contribution to subject access (ADR 0016, ADR 0027):
// the person's rights requests, with the clock events and tasks that join to
// them, each classified column keyed by its field id with its sensitivity.
// A request's summary is special category and is the person's own words, so
// it is exported as such. A breach names no person, so none is included. The
// column lists copy the classification map, which a module may not import; a
// test keeps them in step. Read in the caller's transaction, so row-level
// security leaves out any other tenant, and whether or not the tenant has the
// module switched on.

import type {
  SubjectData,
  SubjectDataContribution,
  SubjectDataRow,
} from '@pixel-scientists/domain/platform/subject-access';

import type { Tx } from './context.ts';

type Cell = SubjectDataRow[string];
type Columns = readonly (readonly [string, Cell['sensitivity']])[];

const internal = (...names: string[]): Columns => names.map((name) => [name, 'internal']);

/** Each table, its classified columns, and its subject path: the column that holds the person's id, or joins to the parent. */
export const subjectTables: Readonly<
  Record<string, { column: string; parent?: string; columns: Columns }>
> = {
  'privacy.rights_request': {
    column: 'subject_person_id',
    columns: [
      ...internal(
        'tenant_id',
        'id',
        'kind',
        'subject_person_id',
        'received_at',
        'received_on',
        'channel',
      ),
      ['summary', 'special_category'],
      ...internal(
        'identity_check',
        'clock_state',
        'due_on',
        'export_job_request_id',
        'erasure_job_request_id',
        'created_at',
        'created_by',
        'updated_at',
        'updated_by',
      ),
    ],
  },
  'privacy.request_clock_event': {
    column: 'request_id',
    parent: 'privacy.rights_request',
    columns: internal(
      'tenant_id',
      'id',
      'request_id',
      'kind',
      'occurred_on',
      'months',
      'reason_code',
      'recorded_by',
      'created_at',
    ),
  },
  'privacy.request_task': {
    column: 'request_id',
    parent: 'privacy.rights_request',
    columns: [
      ...internal('tenant_id', 'id', 'request_id'),
      ['title', 'personal'],
      ...internal(
        'assigned_to',
        'module_id',
        'due_on',
        'completed_by',
        'completed_at',
        'created_at',
        'created_by',
        'updated_at',
        'updated_by',
      ),
    ],
  },
};

type Tables = Record<string, Record<string, unknown>>;
type StoredRow = Record<string, unknown>;

/** The cell for a stored value; a timestamp is its ISO text. */
const cellValue = (value: unknown): Cell['value'] =>
  value instanceof Date ? value.toISOString() : ((value ?? null) as Cell['value']);

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
    .select((eb) =>
      columns.map(([name]) =>
        // A date is read as text so no time zone touches it.
        name.endsWith('_on') ? eb.cast<string>(name, 'text').as(name) : eb.ref(name).as(name),
      ),
    )
    .where(column, 'in', values)
    .orderBy('id')
    .execute();
}

export const privacySubjectData: SubjectDataContribution<'privacy', Tx> = {
  module: 'privacy',
  async subjectData(tx, subjectPartyId) {
    const data: SubjectData = {};
    const read: Record<string, StoredRow[]> = {};
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
            { value: cellValue(row[name]), sensitivity },
          ]),
        ),
      );
    }
    return data;
  },
};
