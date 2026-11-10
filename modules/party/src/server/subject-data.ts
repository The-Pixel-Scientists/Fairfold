// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's contribution to subject access (ADR 0016, ADR 0027): the
// subject's rows in every party table whose subject path is a party column
// that a person's id can match, each classified column keyed by its field id
// with its sensitivity. The lists below copy the classification map, which a
// module may not import; a test keeps them in step, and the platform checks
// every cell against the map again before writing it. Read in the caller's
// transaction, so row-level security leaves out any other tenant.

import type {
  SubjectData,
  SubjectDataContribution,
  SubjectDataRow,
} from '@pixel-scientists/domain/platform/subject-access';

import type { Tx } from './tables.ts';

type Cell = SubjectDataRow[string];
type Sensitivity = Cell['sensitivity'];

const columns = (sensitivity: Sensitivity, ...names: string[]) =>
  names.map((name) => [name, sensitivity] as const);

const keyAndActors = columns(
  'internal',
  'tenant_id',
  'id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
);

/**
 * Each table, the column that holds the subject's party id (a relationship
 * holds it in either of two, and is read in both directions), and its
 * classified columns.
 */
export const subjectTables: Readonly<
  Record<
    string,
    {
      subjectColumn: string | readonly [string, string];
      columns: readonly (readonly [string, Sensitivity])[];
    }
  >
> = {
  'party.party': {
    subjectColumn: 'id',
    columns: [
      ...keyAndActors,
      ...columns('internal', 'kind', 'status', 'merged_into', 'erased_at'),
    ],
  },
  'party.person': {
    subjectColumn: 'id',
    columns: [
      ...keyAndActors,
      ...columns('internal', 'kind'),
      ...columns('personal', 'given_name', 'family_name', 'email', 'phone', 'user_id'),
    ],
  },
  'party.relationship': {
    subjectColumn: ['subject_id', 'object_id'],
    columns: [
      ...keyAndActors,
      ...columns(
        'internal',
        'type',
        'subject_id',
        'subject_kind',
        'object_id',
        'object_kind',
        'starts_on',
        'ends_on',
      ),
    ],
  },
  'party.consent': {
    subjectColumn: 'person_id',
    columns: [
      ...columns('internal', 'tenant_id', 'id'),
      ...columns(
        'personal',
        'person_id',
        'purpose',
        'channel',
        'state',
        'privacy_notice_version',
        'source',
        'recorded_at',
        'recorded_by',
      ),
    ],
  },
  'party.value_history': {
    subjectColumn: 'party_id',
    columns: [
      ...columns(
        'internal',
        'tenant_id',
        'id',
        'party_id',
        'party_kind',
        'field_id',
        'changed_by',
        'changed_at',
      ),
      ...columns('personal', 'old_value', 'new_value'),
    ],
  },
};

type Tables = Record<string, Record<string, unknown>>;

/** The cell for a stored value; a timestamp is its ISO text. */
function cellValue(value: unknown): Cell['value'] {
  if (value instanceof Date) return value.toISOString();
  // The driver reads these tables' other columns as strings, numbers, booleans or JSON.
  return (value ?? null) as Cell['value'];
}

/**
 * The merge set of a party (ADR 0025): its survivor and every party merged
 * into that survivor, each of which keeps the ids its consent, value history
 * and audit events were written with. An unknown id answers itself, so the
 * rows read from it are none.
 */
export async function partyMergeSet(tx: Tx, partyId: string): Promise<string[]> {
  const db = tx.$extendTables<Tables>();
  const named = await db
    .selectFrom('party.party')
    .select(['id', 'merged_into'])
    .where('id', '=', partyId)
    .executeTakeFirst();
  if (!named) return [partyId];
  const survivor = String(named['merged_into'] ?? named['id']);
  const merged = await db
    .selectFrom('party.party')
    .select('id')
    .where('merged_into', '=', survivor)
    .orderBy('id')
    .execute();
  return [survivor, ...merged.map((row) => String(row['id']))];
}

export const partySubjectData: SubjectDataContribution<'party', Tx> = {
  module: 'party',
  async subjectData(tx, subjectPartyId) {
    const db = tx.$extendTables<Tables>();
    const data: SubjectData = {};
    for (const [table, { subjectColumn, columns: fields }] of Object.entries(subjectTables)) {
      const rows = await db
        .selectFrom(table)
        .select(fields.map(([column]) => column))
        .where((eb) =>
          eb.or([subjectColumn].flat().map((column) => eb(column, '=', subjectPartyId))),
        )
        .orderBy('id')
        .execute();
      data[table] = rows.map((row) =>
        Object.fromEntries(
          fields.map(([column, sensitivity]) => [
            `${table}.${column}`,
            { value: cellValue(row[column]), sensitivity },
          ]),
        ),
      );
    }
    return data;
  },
};
