// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How the planner runs each search shape on a seeded tenant, as each app role
// that has schema ext. app_worker cannot read search_vector or an identifier,
// so it has only the four trigram shapes left to try.
//
// The operator functions behind pg_trgm and full-text search are not
// LEAKPROOF, and row-level security is forced on these tables, so PostgreSQL
// applies the tenant policy first and cannot use a search condition as an
// index condition. Each search is therefore a scan of the caller's tenant
// that filters every row, and no app role can use migration 0050's GIN
// indexes, even with sequential scans turned off. These tests pin that safe
// order; they do not show that a search index serves a query.

import { beforeAll, describe, expect, it } from 'vitest';

import { asMigratorIn, asRoleIn, createTestTenant, type TestTenant } from '../tenants.ts';
import { SHAPES, TERMS, type Shape, type ShapeName } from './fixtures.ts';

const COUNT = 3000;
const WORKER_SHAPES: readonly ShapeName[] = [
  'organisation name',
  'given name',
  'family name',
  'email',
];
let tenant: TestTenant;

beforeAll(async () => {
  tenant = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    await client.query(
      `WITH p AS (
         INSERT INTO party.party (tenant_id, kind)
         SELECT $1::uuid, 'organisation' FROM pg_catalog.generate_series(1, $2::integer)
         RETURNING id),
       o AS (
         INSERT INTO party.organisation
           (tenant_id, id, name, legal_form, address_line1, address_town, address_postcode)
         SELECT $1::uuid, p.id, 'Hall ' || p.id, 'community_benefit_society', '1 High Street',
                'Northfield', 'NF1 2AB'
           FROM p RETURNING id)
       INSERT INTO party.organisation_identifier (tenant_id, organisation_id, scheme, identifier)
       SELECT $1::uuid, o.id, 'GB-CHC',
              pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(o.id::text, '-', ''), 1, 7))
         FROM o`,
      [tenant.id, COUNT],
    );
    await client.query(
      `WITH p AS (
         INSERT INTO party.party (tenant_id, kind)
         SELECT $1::uuid, 'person' FROM pg_catalog.generate_series(1, $2::integer)
         RETURNING id)
       INSERT INTO party.person (tenant_id, id, given_name, family_name, email)
       SELECT $1::uuid, p.id, 'Given' || pg_catalog.substr(p.id::text, 1, 8),
              'Family' || pg_catalog.substr(p.id::text, 1, 8), p.id || '@example.test'
         FROM p`,
      [tenant.id, COUNT],
    );
    await client.query('ANALYZE party.organisation');
    await client.query('ANALYZE party.organisation_identifier');
    await client.query('ANALYZE party.person');
  });
}, 120_000);

describe.each([
  ['app_api', SHAPES],
  ['app_worker', SHAPES.filter(([name]) => WORKER_SHAPES.includes(name))],
] as const)('plans under row-level security as %s', (role, shapes) => {
  const cases = shapes.map((shape): [string, Shape] => [shape[0], shape]);

  it.each(cases)('applies the tenant policy first and no search index to %s', async (_, shape) => {
    const [name, table, , condition] = shape;
    const plan = await asRoleIn(role, tenant.id, async (client) => {
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT 1 FROM ${table} WHERE ${condition}`,
        [TERMS[name]],
      );
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toMatch(/app\.tenant_id/u);
    expect(plan).toMatch(/Filter:.*(ext\.%|@@)/u);
    expect(plan).not.toMatch(/Index Cond:.*(ext\.%|@@)/u);
    expect(plan).not.toMatch(/(?:using|on) \S*(?:_trgm|_search_vector)\b/u);
  });
});
