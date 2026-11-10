// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The party module's subject access contribution against the test database,
// as app_worker (the role the export job runs as) in a tenant's transaction:
// the person's rows in every party table whose subject path is a party
// column, only classified columns, the merge set of a merged duplicate, and
// nothing of another person or another tenant.

import { classification } from '@pixel-scientists/db/classification';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addOrganisation, addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { partyMergeSet, partySubjectData } from './subject-data.ts';
import type { Tx } from './tables.ts';

interface Fixture {
  readonly tenant: TestTenant;
  readonly person: string;
  readonly duplicate: string;
  readonly organisation: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const person = await addPerson(client, tenant, { given_name: 'Ada', family_name: 'Lovelace' });
    await addPerson(client, tenant, { given_name: 'Grace' });
    await insertRow(client, 'party.consent', {
      tenant_id: tenant.id,
      person_id: person,
      purpose: 'future_funding',
      channel: 'email',
      state: 'given',
      privacy_notice_version: '2026-10',
      source: 'portal',
      recorded_by: await addMember(client, tenant),
    });
    const duplicate = await addPerson(client, tenant, { given_name: 'Augusta' });
    await insertRow(client, 'party.consent', {
      tenant_id: tenant.id,
      person_id: duplicate,
      purpose: 'future_funding',
      channel: 'email',
      state: 'given',
      privacy_notice_version: '2026-09',
      source: 'portal',
      recorded_by: await addMember(client, tenant),
    });
    await client.query("UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1", [
      duplicate,
      person,
    ]);
    return { tenant, person, duplicate, organisation: await addOrganisation(client, tenant) };
  });
}

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_worker', 4);
  db = createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([addFixture(), addFixture()]);
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

const read = (tenant: TestTenant, subject: string) =>
  withTenant(db, trustedTenantId(tenant.id), (tx: Tx) => partySubjectData.subjectData(tx, subject));

const mergeSet = (tenant: TestTenant, party: string) =>
  withTenant(db, trustedTenantId(tenant.id), (tx: Tx) => partyMergeSet(tx, party));

describe('partyMergeSet', { timeout: 30_000 }, () => {
  it('names the survivor then the parties merged into it, from either end', async () => {
    const expected = [a.person, a.duplicate];
    expect(await mergeSet(a.tenant, a.person)).toEqual(expected);
    expect(await mergeSet(a.tenant, a.duplicate)).toEqual(expected);
  });

  it('answers a party with no merges, or from another tenant, as itself', async () => {
    expect(await mergeSet(a.tenant, a.organisation)).toEqual([a.organisation]);
    expect(await mergeSet(a.tenant, b.person)).toEqual([b.person]);
    expect(await mergeSet(b.tenant, a.person)).toEqual([a.person]);
  });
});

describe('partySubjectData', { timeout: 30_000 }, () => {
  it("keeps a merged duplicate's own rows under its own id", async () => {
    const data = await read(a.tenant, a.duplicate);
    expect(data['party.person']?.[0]?.['party.person.given_name']?.value).toBe('Augusta');
    expect(data['party.consent']?.[0]?.['party.consent.privacy_notice_version']?.value).toBe(
      '2026-09',
    );
    expect(JSON.stringify(await read(a.tenant, a.person))).not.toContain('Augusta');
  });

  it("returns the person's rows with each value's field id and sensitivity", async () => {
    const data = await read(a.tenant, a.person);
    expect(data['party.person']).toHaveLength(1);
    expect(data['party.person']?.[0]?.['party.person.given_name']).toEqual({
      value: 'Ada',
      sensitivity: 'personal',
    });
    expect(data['party.party']?.[0]?.['party.party.kind']?.value).toBe('person');
    expect(data['party.consent']?.[0]?.['party.consent.purpose']).toEqual({
      value: 'future_funding',
      sensitivity: 'personal',
    });
  });

  it('returns only columns the classification map lists', async () => {
    const data = await read(a.tenant, a.person);
    for (const [table, rows] of Object.entries(data)) {
      const listed = Object.keys(classification[table] ?? {}).map((column) => `${table}.${column}`);
      for (const row of rows) expect(listed).toEqual(expect.arrayContaining(Object.keys(row)));
    }
  });

  it("returns nothing of another person's, an organisation's or another tenant's", async () => {
    expect(JSON.stringify(await read(a.tenant, a.person))).not.toContain('Grace');
    expect((await read(a.tenant, a.organisation))['party.person']).toEqual([]);
    for (const [tenant, stranger] of [
      [a.tenant, b.person],
      [b.tenant, a.person],
    ] as const) {
      const data = await read(tenant, stranger);
      for (const rows of Object.values(data)) expect(rows).toEqual([]);
    }
  });
});
