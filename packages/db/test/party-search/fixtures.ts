// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fixtures for the party search tests (migration 0050): each search shape
// the columns are indexed for, with terms as parameters, and a seeded tenant.

import type pg from 'pg';

import { addOrganisation, addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type Row,
  type TestTenant,
} from '../tenants.ts';

const TSQUERY = `pg_catalog.plainto_tsquery('pg_catalog.simple'::regconfig, $1)`;
const TSMATCH = `search_vector OPERATOR(pg_catalog.@@) ${TSQUERY}`;

/** Each search shape, as `[name, table, column returned, condition on $1]`. */
export const SHAPES = [
  ['organisation name', 'party.organisation', 'id', 'name OPERATOR(ext.%) $1'],
  [
    'identifier',
    'party.organisation_identifier',
    'organisation_id',
    'identifier OPERATOR(ext.%) $1',
  ],
  ['given name', 'party.person', 'id', 'given_name OPERATOR(ext.%) $1'],
  ['family name', 'party.person', 'id', 'family_name OPERATOR(ext.%) $1'],
  ['email', 'party.person', 'id', 'email OPERATOR(ext.%) $1'],
  ['organisation tsvector', 'party.organisation', 'id', TSMATCH],
  ['person tsvector', 'party.person', 'id', TSMATCH],
] as const;

export type Shape = (typeof SHAPES)[number];
export type ShapeName = Shape[0];

/** The synthetic value each shape searches for, shared across tenants. */
export const TERMS: Readonly<Record<ShapeName, string>> = {
  'organisation name': 'Penllwyn Village Hall',
  identifier: '9990123',
  'given name': 'Gwenllian',
  'family name': 'Prosser',
  email: 'gwenllian.prosser@example.test',
  'organisation tsvector': 'Penllwyn',
  'person tsvector': 'gwenllian',
};

/** Ids matched by `shape` for `term` on `client`, under any further condition `also`. */
export async function search(
  client: pg.ClientBase,
  shape: Shape,
  term: string,
  also = 'true',
): Promise<string[]> {
  const [, table, column, condition] = shape;
  const { rows } = await client.query<{ found: string }>(
    `SELECT ${column} AS found FROM ${table} WHERE ${condition} AND ${also} ORDER BY 1`,
    [term],
  );
  return rows.map((row) => row.found);
}

export interface SeededTenant {
  readonly tenant: TestTenant;
  readonly organisation: string;
  readonly person: string;
}

/** A tenant with one organisation, identifier and person holding the shared values. */
export async function seedTenant(person: Row = {}): Promise<SeededTenant> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const organisation = await addOrganisation(client, tenant, {
      name: 'Penllwyn Village Hall',
    });
    await insertRow(client, 'party.organisation_identifier', {
      tenant_id: tenant.id,
      organisation_id: organisation,
      scheme: 'GB-CHC',
      identifier: '9990123',
    });
    const id = await addPerson(client, tenant, {
      given_name: 'Gwenllian',
      family_name: 'Prosser',
      email: 'gwenllian.prosser@example.test',
      ...person,
    });
    return { tenant, organisation, person: id };
  });
}

/** A member of staff in `tenant`, for erasure requests. */
export function staffOf(tenant: TestTenant): Promise<string> {
  return asMigratorIn(tenant.id, (client) => addMember(client, tenant));
}
