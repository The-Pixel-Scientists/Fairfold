// SPDX-License-Identifier: AGPL-3.0-or-later
//
// After party.erase_party(), the real function, nothing about a person can
// be found: every search on their former values returns no row and their
// tsvector is empty. The placeholder email is left to the search itself: it
// embeds the party id, so its trigram score for a term such as "erased
// invalid" differs between erased people and can reach the threshold. Person
// searches therefore exclude erased parties (S12-10), and these tests run
// that query shape.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { addErasureRequest, erase } from '../erasure/fixtures.ts';
import { personRow } from '../party/fixtures.ts';
import {
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { search, SHAPES, staffOf, type Shape } from './fixtures.ts';

const PERSON_SHAPES = SHAPES.filter((shape: Shape) => shape[1] === 'party.person');
const FORMER = [
  ['Gwenllian', 'Prosser', 'gwenllian.prosser@example.test'],
  ['Bethan', 'Probert', 'bethan.probert@example.test'],
] as const;
const PLACEHOLDER_TERM = 'erased invalid';
const NOT_ERASED = `EXISTS (SELECT 1 FROM party.party p
  WHERE p.tenant_id = person.tenant_id AND p.id = person.id AND p.status <> 'erased')`;

let tenant: TestTenant;
let staff: string;
let reachable: string;
const people: string[] = [];

const inTenant = <T>(work: (client: pg.Client) => Promise<T>) =>
  asRoleIn('app_api', tenant.id, work);

/** A party id whose placeholder email the trigram route finds for `PLACEHOLDER_TERM`. */
function reachableId(): Promise<string> {
  return inTenant(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM (SELECT pg_catalog.gen_random_uuid() AS id
                         FROM pg_catalog.generate_series(1, 500)) AS candidate
        WHERE (id::text || '@erased.invalid') OPERATOR(ext.%) $1 LIMIT 1`,
      [PLACEHOLDER_TERM],
    );
    const [row] = rows;
    if (!row) throw new Error('No candidate id scored above the trigram threshold.');
    return row.id;
  });
}

/** Add a person on party `id` and erase them through the real function. */
async function addErased(person: Row, id: string = randomUUID()): Promise<string> {
  const request = await asMigratorIn(tenant.id, async (client) => {
    await insertRow(client, 'party.party', { tenant_id: tenant.id, id, kind: 'person' });
    await insertRow(client, 'party.person', personRow(tenant, id, person));
    return addErasureRequest(client, tenant, staff, id);
  });
  const { code } = await erase(tenant, id, request);
  expect(code).toBeUndefined();
  return id;
}

beforeAll(async () => {
  tenant = await createTestTenant();
  staff = await staffOf(tenant);
  for (const [given_name, family_name, email] of FORMER) {
    people.push(await addErased({ given_name, family_name, email }));
  }
  reachable = await addErased(
    { given_name: 'Morfydd', family_name: 'Pugh', email: 'morfydd.pugh@example.test' },
    await reachableId(),
  );
});

describe('an erased person', () => {
  it('has an empty tsvector and the database placeholder email', async () => {
    const rows = await inTenant(async (client) => {
      const result = await client.query<{ id: string; words: number; email: string }>(
        `SELECT id, pg_catalog.length(search_vector) AS words, email
           FROM party.person WHERE id = ANY ($1::uuid[])`,
        [people],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.words).toBe(0);
      expect(row.email).toBe(`${row.id}@erased.invalid`);
    }
  });

  it.each(FORMER.flat())('cannot be found by the former value %s', async (term) => {
    for (const shape of PERSON_SHAPES) {
      expect(await inTenant((client) => search(client, shape, term))).toEqual([]);
    }
  });

  it('is reached through the placeholder when a search does not exclude erased parties', async () => {
    const found = await Promise.all(
      PERSON_SHAPES.map((shape) => inTenant((client) => search(client, shape, PLACEHOLDER_TERM))),
    );
    expect(found.flat()).toContain(reachable);
  });

  it.each([
    'Gwenllian Prosser',
    'someone@example.test',
    'erased',
    'invalid',
    PLACEHOLDER_TERM,
    '@erased.invalid',
  ])('is not reached by the term %s once erased parties are excluded', async (term) => {
    for (const shape of PERSON_SHAPES) {
      expect(await inTenant((client) => search(client, shape, term, NOT_ERASED))).toEqual([]);
    }
  });
});
