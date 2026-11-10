// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Search as app_api: ranking on synthetic data at ADR 0025's defaults
// (pg_trgm's 0.3 for the operator, 0.6 for a name), and every shape inside
// the caller's tenant.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { expectCrossTenantDenial, type RowFactory } from '../cross-tenant.ts';
import {
  addOrganisation,
  addParty,
  addPerson,
  organisationRow,
  personRow,
} from '../party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../tenants.ts';
import { search, seedTenant, SHAPES, TERMS, type SeededTenant, type Shape } from './fixtures.ts';

const NAME_THRESHOLD = 0.6;

describe('ranking', () => {
  let tenant: TestTenant;

  beforeAll(async () => {
    tenant = await createTestTenant();
    await asMigratorIn(tenant.id, async (client) => {
      for (const name of ['Penllwyn Village Hall', 'Penllwn Village Hall', 'Harbour Rowing Club']) {
        await addOrganisation(client, tenant, { name });
      }
      for (const [given, family, email] of [
        ['Gwenllian', 'Prosser', 'gwenllian@example.test'],
        ['Gwenlian', 'Probert', 'gwenlian@example.test'],
        ['Tomas', 'Okafor', 'tomas@example.test'],
      ] as const) {
        await addPerson(client, tenant, { given_name: given, family_name: family, email });
      }
      for (const [name, identifier] of [
        ['Registered Charity', '9990123'],
        ['Unrelated Charity', '8884567'],
      ] as const) {
        const organisation = await addOrganisation(client, tenant, { name });
        await insertRow(client, 'party.organisation_identifier', {
          tenant_id: tenant.id,
          organisation_id: organisation,
          scheme: 'GB-CHC',
          identifier,
        });
      }
    });
  });

  const ranked = (table: string, column: string, term: string) =>
    asRoleIn('app_api', tenant.id, async (client) => {
      const { rows } = await client.query<{ value: string; score: number }>(
        `SELECT ${column} AS value, ext.similarity(${column}, $1)::float AS score FROM ${table}
          WHERE ${column} OPERATOR(ext.%) $1 ORDER BY score DESC`,
        [term],
      );
      return rows;
    });

  it('ranks an exact name above a one-letter typo and leaves out an unrelated name', async () => {
    const organisations = await ranked('party.organisation', 'name', 'Penllwyn Village Hall');
    expect(organisations.map((row) => row.value)).toEqual([
      'Penllwyn Village Hall',
      'Penllwn Village Hall',
    ]);
    expect(organisations[0]?.score).toBe(1);
    expect(organisations[1]?.score).toBeGreaterThanOrEqual(NAME_THRESHOLD);

    const people = await ranked('party.person', 'given_name', 'Gwenllian');
    expect(people.map((row) => row.value)).toEqual(['Gwenllian', 'Gwenlian']);
    expect(people[0]?.score).toBeGreaterThan(people[1]?.score ?? 1);
  });

  it.each([
    ['a missing digit', '999012'],
    ['a transposed digit', '9990132'],
  ])('finds an identifier with %s', async (_, term) => {
    const rows = await ranked('party.organisation_identifier', 'identifier', term);
    expect(rows.map((row) => row.value)).toEqual(['9990123']);
  });

  it('matches an email address whatever the case of the term', async () => {
    const rows = await ranked('party.person', 'email', 'GWENLLIAN@EXAMPLE.TEST');
    expect(rows[0]?.value).toBe('gwenllian@example.test');
    expect(rows[0]?.score).toBe(1);
  });
});

describe('two tenants with the same values', () => {
  let a: SeededTenant;
  let b: SeededTenant;

  beforeAll(async () => {
    [a, b] = await Promise.all([seedTenant(), seedTenant()]);
  });

  const cases = SHAPES.map((shape): [string, Shape] => [shape[0], shape]);

  it.each(cases)("keeps %s inside the caller's tenant", async (_, shape) => {
    const own = (seeded: SeededTenant) =>
      shape[1] === 'party.person' ? seeded.person : seeded.organisation;
    const term = TERMS[shape[0]];
    expect(await asRoleIn('app_api', a.tenant.id, (client) => search(client, shape, term))).toEqual(
      [own(a)],
    );
    expect(await asRoleIn('app_api', b.tenant.id, (client) => search(client, shape, term))).toEqual(
      [own(b)],
    );
    expect(await withClient('app_api', (client) => search(client, shape, term))).toEqual([]);
  });

  const organisation: RowFactory = async (client: pg.ClientBase, owner) =>
    organisationRow(owner, await addParty(client, owner, 'organisation'));
  const person: RowFactory = async (client: pg.ClientBase, owner) =>
    personRow(owner, await addParty(client, owner, 'person'));
  const identifier: RowFactory = async (client: pg.ClientBase, owner) => ({
    tenant_id: owner.id,
    organisation_id: await addOrganisation(client, owner),
    scheme: 'GB-CHC',
    identifier: '9990123',
  });

  it.each([
    ['party.organisation', organisation],
    ['party.person', person],
    ['party.organisation_identifier', identifier],
  ] as const)('denies %s across tenants', async (table, row) => {
    await expectCrossTenantDenial(table, row);
  });
});
