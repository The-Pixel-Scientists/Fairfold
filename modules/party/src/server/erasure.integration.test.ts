// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's erasure contribution against the test database, as
// app_worker (the role the erasure job runs as) in a tenant's transaction:
// the named party and its merge set, anonymised in place through the
// approved function for a running request, with counts by table, nothing of
// another person, and nothing across tenants.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addErasureRequest } from '../../../../packages/db/test/erasure/fixtures.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { partyErasure, partyErasureTarget } from './erasure.ts';
import type { Tx } from './tables.ts';

interface Fixture {
  readonly tenant: TestTenant;
  readonly person: string;
  readonly duplicate: string;
  readonly bystander: string;
  readonly organisation: string;
  readonly request: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const member = await addMember(client, tenant);
    const person = await addPerson(client, tenant, { given_name: 'Ada', family_name: 'Lovelace' });
    const duplicate = await addPerson(client, tenant, { given_name: 'Augusta' });
    await client.query("UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
      duplicate,
      person,
    ]);
    const bystander = await addPerson(client, tenant, { given_name: 'Grace' });
    const organisation = await addOrganisation(client, tenant);
    const request = await addErasureRequest(client, tenant, member, person);
    return { tenant, person, duplicate, bystander, organisation, request };
  });
}

const inTenant = <T>(fixture: Fixture, work: (tx: Tx) => Promise<T>) =>
  withTenant(db, trustedTenantId(fixture.tenant.id), work);

const nameOf = (fixture: Fixture, id: string) =>
  asMigratorIn(fixture.tenant.id, async (client) => {
    const { rows } = await client.query<{ given_name: string | null; status: string }>(
      'SELECT n.given_name, p.status FROM party.person n JOIN party.party p ON p.id = n.id WHERE n.id = $1',
      [id],
    );
    return rows[0];
  });

beforeAll(async () => {
  const settings = databaseSettings('app_worker', 4);
  db = createDatabase<unknown>({
    host: settings.host,
    port: settings.port,
    database: settings.database,
    password: settings.password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  a = await addFixture();
  b = await addFixture();
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

describe('partyErasureTarget', () => {
  it('names the merge set with the person’s values, and whether the party is a person already erased', async () => {
    const target = await inTenant(a, (tx) => partyErasureTarget(tx, a.duplicate));

    expect(target).toMatchObject({ kind: 'person', erased: false });
    expect(target?.subjects.map(({ partyId }) => partyId)).toEqual(
      expect.arrayContaining([a.person, a.duplicate]),
    );
    expect(target?.subjects).toContainEqual(
      expect.objectContaining({ partyId: a.person, givenName: 'Ada', familyName: 'Lovelace' }),
    );
  });

  it('reads an organisation as one, and another tenant’s party and an unknown id as none', async () => {
    expect(await inTenant(a, (tx) => partyErasureTarget(tx, a.organisation))).toMatchObject({
      kind: 'organisation',
    });
    expect(await inTenant(a, (tx) => partyErasureTarget(tx, b.person))).toBeNull();
    expect(await inTenant(a, (tx) => partyErasureTarget(tx, crypto.randomUUID()))).toBeNull();
  });
});

describe('partyErasure', () => {
  it('refuses without a running request naming one of the parties, and changes nothing', async () => {
    const subjects = [
      { partyId: a.bystander, givenName: null, familyName: null, email: null, accountId: null },
    ];

    await expect(inTenant(a, (tx) => partyErasure.erase(tx, subjects))).rejects.toThrow(
      'Erasure needs a running erasure request for the party.',
    );
    expect(await nameOf(a, a.bystander)).toEqual({ given_name: 'Grace', status: 'active' });
  });

  it('does nothing in tenant B for tenant A’s party, whatever request B holds', async () => {
    const target = await inTenant(a, (tx) => partyErasureTarget(tx, a.person));
    const counts = inTenant(b, (tx) => partyErasure.erase(tx, target?.subjects ?? []));

    await expect(counts).rejects.toThrow('Erasure needs a running erasure request');
    expect(await nameOf(a, a.person)).toEqual({ given_name: 'Ada', status: 'active' });
  });

  it('anonymises the whole merge set in place and answers counts by table, then answers zero', async () => {
    const target = await inTenant(a, (tx) => partyErasureTarget(tx, a.person));
    const counts = await inTenant(a, (tx) => partyErasure.erase(tx, target?.subjects ?? []));

    expect(counts).toMatchObject({ 'party.party': 2, 'party.person': 2 });
    expect(await nameOf(a, a.person)).toEqual({ given_name: null, status: 'erased' });
    expect(await nameOf(a, a.duplicate)).toEqual({ given_name: null, status: 'erased' });
    expect(await nameOf(a, a.bystander)).toEqual({ given_name: 'Grace', status: 'active' });
    expect(await nameOf(b, b.person)).toEqual({ given_name: 'Ada', status: 'active' });

    const again = await inTenant(a, (tx) => partyErasure.erase(tx, target?.subjects ?? []));
    expect(again).toMatchObject({ 'party.party': 0, 'party.person': 0 });
  });
});
