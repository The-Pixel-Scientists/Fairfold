// SPDX-License-Identifier: AGPL-3.0-or-later
//
// crm's contributions to subject access and erasure against the test
// database, with crm switched off for the tenant: the rows are read and
// anonymised whether or not the module is on. Subject access runs as app_api
// and erasure as app_worker, the role of the erasure job. Values are
// invented. A second tenant holds the same rows and must stay untouched.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import {
  addImportJob,
  importRowRow,
  mergeRow,
  noteRow,
  referenceRow,
  SUMMARY,
} from '../../../../packages/db/test/crm/fixtures.ts';
import { addErasureRequest, erase } from '../../../../packages/db/test/erasure/fixtures.ts';
import { addPerson } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import type { Tx } from './context.ts';
import { crmErasure } from './erasure.ts';
import { crmSubjectData } from './subject-data.ts';

interface Fixture {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly person: string;
  readonly other: string;
  readonly note: string;
}

const CELLS = { given_name: 'Ada', family_name: 'Example', email: 'ada@example.test' };

let api: ReturnType<typeof createDatabase<unknown>>;
let worker: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const member = await addMember(client, tenant);
    const person = await addPerson(client, tenant);
    const other = await addPerson(client, tenant);
    await client.query(
      "INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by) VALUES ($1, 'crm', false, $2)",
      [tenant.id, member],
    );
    const note = await insertRow(client, 'crm.interaction', noteRow(tenant, person, member));
    await insertRow(client, 'crm.interaction', noteRow(tenant, other, member));
    const list = await insertRow(client, 'crm.list', {
      tenant_id: tenant.id,
      name: 'Synthetic list',
      created_by: member,
      updated_by: member,
    });
    await insertRow(client, 'crm.list_member', {
      tenant_id: tenant.id,
      list_id: list,
      party_id: person,
      added_by: member,
    });
    await insertRow(client, 'crm.external_reference', referenceRow(tenant, person, member));
    await insertRow(client, 'crm.merge_record', mergeRow(tenant, other, person, member));
    const job = await addImportJob(client, tenant, member);
    await insertRow(
      client,
      'crm.import_row',
      importRowRow(tenant, job, { created_party_id: person }),
    );
    return { tenant, member, person, other, note };
  });
}

const inTenant = <T>(db: typeof api, fixture: Fixture, work: (tx: Tx) => Promise<T>): Promise<T> =>
  withTenant(db, trustedTenantId(fixture.tenant.id), work);

const rows = <T extends object>(fixture: Fixture, sql: string, values: unknown[]) =>
  asMigratorIn(fixture.tenant.id, async (client) => (await client.query<T>(sql, values)).rows);

beforeAll(async () => {
  const apiSettings = databaseSettings('app_api', 4);
  api = createDatabase<unknown>({
    host: apiSettings.host,
    port: apiSettings.port,
    database: apiSettings.database,
    password: apiSettings.password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  const workerSettings = databaseSettings('app_worker', 4);
  worker = createDatabase<unknown>({
    host: workerSettings.host,
    port: workerSettings.port,
    database: workerSettings.database,
    password: workerSettings.password,
    role: 'app_worker',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([addFixture(), addFixture()]);
}, 60_000);

afterAll(async () => {
  await api.destroy();
  await worker.destroy();
});

describe('crmSubjectData', () => {
  it('lists the person’s rows in every crm table with each value’s sensitivity, and no other person’s or tenant’s', async () => {
    const data = await inTenant(api, a, (tx) => crmSubjectData.subjectData(tx, a.person));

    expect(Object.keys(data).sort()).toEqual([
      'crm.duplicate_dismissal',
      'crm.external_reference',
      'crm.import_row',
      'crm.interaction',
      'crm.list_member',
      'crm.merge_record',
    ]);
    expect(data['crm.interaction']).toHaveLength(1);
    expect(data['crm.interaction']?.[0]?.['crm.interaction.summary']).toEqual({
      value: SUMMARY,
      sensitivity: 'personal',
    });
    expect(data['crm.interaction']?.[0]?.['crm.interaction.id']?.value).toBe(a.note);
    expect(data['crm.import_row']?.[0]?.['crm.import_row.cells']?.sensitivity).toBe('personal');
    expect(JSON.stringify(data)).not.toContain(b.note);
    const theirs = await inTenant(api, a, (tx) => crmSubjectData.subjectData(tx, b.person));
    expect(Object.values(theirs).flat()).toEqual([]);
  });
});

describe('crmErasure', () => {
  const subject = (fixture: Fixture) => [
    { partyId: fixture.person, givenName: null, familyName: null, email: null, accountId: null },
  ];

  async function erasedParty(fixture: Fixture) {
    const request = await asMigratorIn(fixture.tenant.id, (client) =>
      addErasureRequest(client, fixture.tenant, fixture.member, fixture.person),
    );
    expect((await erase(fixture.tenant, fixture.person, request)).code).toBeUndefined();
  }

  const summaries = (fixture: Fixture) =>
    rows<{ id: string; summary: string }>(
      fixture,
      'SELECT id, summary FROM crm.interaction ORDER BY id',
      [],
    );

  it('refuses for a party that is not erased yet, and changes nothing', async () => {
    await expect(inTenant(worker, a, (tx) => crmErasure.erase(tx, subject(a)))).rejects.toThrow();
    expect((await summaries(a)).map((row) => row['summary'])).toEqual([SUMMARY, SUMMARY]);
  });

  it('clears the person’s personal values with crm off, keeps the rest, and leaves tenant B alone', async () => {
    await erasedParty(a);

    const counts = await inTenant(worker, a, (tx) => crmErasure.erase(tx, subject(a)));

    expect(counts).toEqual({
      'crm.interaction': 1,
      'crm.import_row': 1,
      'crm.external_reference': 1,
    });
    expect(await summaries(a)).toEqual(
      expect.arrayContaining([
        { id: a.note, summary: 'erased' },
        expect.objectContaining({ summary: SUMMARY }),
      ]),
    );
    expect(await rows<{ cells: object }>(a, 'SELECT cells FROM crm.import_row', [])).toEqual([
      { cells: {} },
    ]);
    expect(
      await rows<{ n: number }>(a, 'SELECT count(*)::int AS n FROM crm.list_member', []),
    ).toEqual([{ n: 1 }]);
    expect((await summaries(b)).map((row) => row['summary'])).toEqual([SUMMARY, SUMMARY]);
    expect(await inTenant(worker, a, (tx) => crmErasure.erase(tx, subject(a)))).toEqual({
      'crm.interaction': 0,
      'crm.import_row': 0,
      'crm.external_reference': 0,
    });
  });

  it('skips a party of another tenant, whatever request that tenant holds', async () => {
    const counts = await inTenant(worker, b, (tx) => crmErasure.erase(tx, subject(a)));

    expect(counts).toEqual({
      'crm.interaction': 0,
      'crm.import_row': 0,
      'crm.external_reference': 0,
    });
    expect((await summaries(b)).map((row) => row['summary'])).toEqual([SUMMARY, SUMMARY]);
  });

  it('clears the pre-erasure rows again after a restore', async () => {
    await asMigratorIn(a.tenant.id, async (client) => {
      await client.query('ALTER TABLE crm.interaction DISABLE TRIGGER refuse_erased_value');
      await client.query('UPDATE crm.interaction SET summary = $1 WHERE id = $2', [
        SUMMARY,
        a.note,
      ]);
      await client.query('ALTER TABLE crm.interaction ENABLE TRIGGER refuse_erased_value');
      await client.query('UPDATE crm.import_row SET cells = $1', [JSON.stringify(CELLS)]);
    });

    const counts = await inTenant(worker, a, (tx) => crmErasure.erase(tx, subject(a)));

    expect(counts).toMatchObject({ 'crm.interaction': 1, 'crm.import_row': 1 });
    expect(
      await rows<{ summary: string }>(a, 'SELECT summary FROM crm.interaction WHERE id = $1', [
        a.note,
      ]),
    ).toEqual([{ summary: 'erased' }]);
  });
});
