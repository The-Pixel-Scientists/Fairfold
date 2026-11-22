// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm's contribution to subject access (ADR 0016, ADR 0027): the subject's
// rows in every crm table whose subject path is a party column, each
// classified column keyed by its field id with its sensitivity. Segment
// membership is worked out when read and stores nothing, so it has no rows.
// The lists below copy the classification map, which a module may not
// import; a test keeps them in step, and the platform checks every cell
// against the map again before writing it. Read in the caller's transaction,
// so row-level security leaves out any other tenant, and whether or not crm
// is switched on for it.

import type {
  SubjectData,
  SubjectDataContribution,
  SubjectDataRow,
} from '@pixel-scientists/domain/platform/subject-access';

import type { Tx } from './context.ts';

type Cell = SubjectDataRow[string];
type Sensitivity = Cell['sensitivity'];

const internal = (...names: string[]) => names.map((name) => [name, 'internal'] as const);
const personal = (...names: string[]) => names.map((name) => [name, 'personal'] as const);

/** Each table, the column or columns that hold the subject's party id, and its classified columns. */
export const subjectTables: Readonly<
  Record<
    string,
    {
      subjectColumn: string | readonly [string, string];
      columns: readonly (readonly [string, Sensitivity])[];
    }
  >
> = {
  'crm.list_member': {
    subjectColumn: 'party_id',
    columns: internal(
      'tenant_id',
      'id',
      'list_id',
      'party_id',
      'added_by',
      'created_at',
      'updated_at',
    ),
  },
  'crm.interaction': {
    subjectColumn: 'party_id',
    columns: [
      ...internal(
        'tenant_id',
        'id',
        'party_id',
        'kind',
        'occurred_at',
        'source_module',
        'source_entity_type',
        'source_entity_id',
        'recorded_by',
        'created_at',
        'updated_at',
      ),
      ...personal('summary'),
    ],
  },
  'crm.merge_record': {
    subjectColumn: ['loser_id', 'survivor_id'],
    columns: internal(
      'tenant_id',
      'id',
      'kind',
      'action',
      'loser_id',
      'survivor_id',
      'repointed_counts',
      'preview_hash',
      'merged_by',
      'merged_at',
    ),
  },
  'crm.import_row': {
    subjectColumn: ['created_party_id', 'duplicate_party_id'],
    columns: [
      ...internal(
        'tenant_id',
        'id',
        'job_id',
        'row_number',
        'errors',
        'duplicate_party_id',
        'created_party_id',
        'created_at',
        'updated_at',
      ),
      ...personal('cells'),
    ],
  },
  'crm.external_reference': {
    subjectColumn: 'party_id',
    columns: [
      ...internal('tenant_id', 'id', 'party_id', 'system', 'added_by', 'created_at', 'updated_at'),
      ...personal('external_id', 'url'),
    ],
  },
};

type Tables = Record<string, Record<string, unknown>>;

/** The cell for a stored value; a timestamp is its ISO text. */
const cellValue = (value: unknown): Cell['value'] =>
  value instanceof Date ? value.toISOString() : ((value ?? null) as Cell['value']);

export const crmSubjectData: SubjectDataContribution<'crm', Tx> = {
  module: 'crm',
  async subjectData(tx, subjectPartyId) {
    const db = tx.$extendTables<Tables>();
    const data: SubjectData = {};
    for (const [table, { subjectColumn, columns }] of Object.entries(subjectTables)) {
      const rows = await db
        .selectFrom(table)
        .select(columns.map(([column]) => column))
        .where((eb) =>
          eb.or([subjectColumn].flat().map((column) => eb(column, '=', subjectPartyId))),
        )
        .orderBy('id')
        .execute();
      data[table] = rows.map((row) =>
        Object.fromEntries(
          columns.map(([column, sensitivity]) => [
            `${table}.${column}`,
            { value: cellValue(row[column]), sensitivity },
          ]),
        ),
      );
    }
    return data;
  },
};
