// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The forms module's contributions to subject access and erasure against the
// test database, with forms switched off for the tenant: the rows are read and
// cleared whether or not the module is on. Subject access runs as app_api and
// erasure as app_worker, the role of the erasure job. Values are invented. A
// second tenant holds the same rows and must stay untouched.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addErasureRequest, erase } from '../../../../packages/db/test/erasure/fixtures.ts';
import {
  addFormsParts,
  ANSWERS,
  anonymousRow,
  publishVersion,
  responseRow,
  SIGNED_IN_DEFINITION,
  type FormsParts,
} from '../../../../packages/db/test/forms/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { formsErasure, formsSubjectData } from './forms-subject.ts';

interface Fixture {
  readonly tenant: TestTenant;
  readonly parts: FormsParts;
  readonly response: string;
  readonly draft: string;
  readonly anonymous: string;
}

const SPECIAL = { ...ANSWERS, f_health: true };
const KEPT = { f_rating: 4, f_venue: 'north' };

let api: ReturnType<typeof createDatabase<unknown>>;
let worker: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const parts = await addFormsParts(client, tenant, { respondents: 'signed_in' });
    const version = await publishVersion(client, tenant, parts.form, parts.member, {
      version: 2,
      definition: JSON.stringify(SIGNED_IN_DEFINITION),
    });
    const response = await insertRow(client, 'forms.response', responseRow(tenant, parts));
    const draft = await insertRow(
      client,
      'forms.response',
      responseRow(
        tenant,
        { ...parts, version },
        { status: 'draft', answers: JSON.stringify(SPECIAL) },
      ),
    );
    const anonymous = await insertRow(
      client,
      'forms.response',
      anonymousRow(tenant, await addFormsParts(client, tenant)),
    );
    return { tenant, parts, response, draft, anonymous };
  });
}

const inTenant = <T>(
  db: typeof api,
  fixture: Fixture,
  work: Parameters<typeof withTenant<unknown, T>>[2],
): Promise<T> => withTenant(db, trustedTenantId(fixture.tenant.id), work);

const answersOf = (fixture: Fixture) =>
  asMigratorIn(fixture.tenant.id, async (client) =>
    Object.fromEntries(
      (
        await client.query<{ id: string; answers: unknown }>(
          'SELECT id, answers FROM forms.response',
        )
      ).rows.map((row) => [row.id, row.answers]),
    ),
  );

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

describe('formsSubjectData', () => {
  it('lists the person’s responses, drafts included, with each answer classed by the version it pinned, and no anonymous or other tenant’s', async () => {
    const data = await inTenant(api, a, (tx) => formsSubjectData.subjectData(tx, a.parts.person));

    const rows = data['forms.response'] ?? [];
    expect(rows.map((row) => row['forms.response.id']?.value).sort()).toEqual(
      [a.response, a.draft].sort(),
    );
    const submitted = rows.find((row) => row['forms.response.id']?.value === a.response);
    expect(submitted?.['forms.response.status']).toEqual({
      value: 'submitted',
      sensitivity: 'internal',
    });
    expect(submitted?.['f_name']).toEqual({ value: 'Synthetic Person', sensitivity: 'personal' });
    expect(submitted?.['f_rating']).toEqual({ value: 4, sensitivity: 'internal' });
    expect(submitted?.['f_venue']).toEqual({ value: 'north', sensitivity: 'public' });
    const draft = rows.find((row) => row['forms.response.id']?.value === a.draft);
    expect(draft?.['f_health']).toEqual({ value: true, sensitivity: 'special_category' });
    expect(JSON.stringify(data)).not.toContain(a.anonymous);
    const theirs = await inTenant(api, a, (tx) => formsSubjectData.subjectData(tx, b.parts.person));
    expect(theirs['forms.response']).toEqual([]);
  });
});

describe('formsErasure', () => {
  const subject = (fixture: Fixture) => [
    {
      partyId: fixture.parts.person,
      givenName: null,
      familyName: null,
      email: null,
      accountId: null,
    },
  ];

  it('refuses for a party that is not erased yet, and changes nothing', async () => {
    await expect(inTenant(worker, a, (tx) => formsErasure.erase(tx, subject(a)))).rejects.toThrow();
    expect((await answersOf(a))[a.response]).toEqual(ANSWERS);
  });

  it('keeps only the answers a public or internal question gave, with forms off, and leaves anonymous responses and tenant B alone', async () => {
    const request = await asMigratorIn(a.tenant.id, (client) =>
      addErasureRequest(client, a.tenant, a.parts.member, a.parts.person),
    );
    expect((await erase(a.tenant, a.parts.person, request)).code).toBeUndefined();

    const counts = await inTenant(worker, a, (tx) => formsErasure.erase(tx, subject(a)));

    expect(counts).toEqual({ 'forms.response': 2 });
    const after = await answersOf(a);
    expect(after[a.response]).toEqual(KEPT);
    expect(after[a.draft]).toEqual(KEPT);
    expect(after[a.anonymous]).toEqual(ANSWERS);
    expect((await answersOf(b))[b.response]).toEqual(ANSWERS);
    expect(await inTenant(worker, a, (tx) => formsErasure.erase(tx, subject(a)))).toEqual({
      'forms.response': 0,
    });
  });

  it('skips a party of another tenant', async () => {
    const counts = await inTenant(worker, b, (tx) => formsErasure.erase(tx, subject(a)));

    expect(counts).toEqual({ 'forms.response': 0 });
    expect((await answersOf(b))[b.response]).toEqual(ANSWERS);
  });
});
