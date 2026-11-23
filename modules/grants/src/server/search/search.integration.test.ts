// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The submission search against the test database, as app_api in a tenant's
// transaction: a submission is found by its organisation's name, a draft is
// never found, and another tenant's submission for an organisation of the
// same name stays out. The names are invented.

import { searchTermSchema } from '@pixel-scientists/domain/platform/search';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import {
  addParts,
  applicationRow,
  submit,
} from '../../../../../packages/db/test/grants/application-fixtures.ts';
import { addOrganisation } from '../../../../../packages/db/test/party/fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import type { Tx } from '../programme/tables.ts';
import { grantsSearch } from './index.ts';

interface Fixture {
  readonly tenant: TestTenant;
  readonly draft: string;
  readonly submitted: string;
}

const NAME = 'Quillfeather Hall';

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const parts = await addParts(client, tenant);
    // One organisation has one live application in a round, so the draft is another's.
    const add = async (name: string) =>
      insertRow(
        client,
        'grants.application',
        applicationRow(tenant, {
          ...parts,
          organisation: await addOrganisation(client, tenant, { name }),
        }),
      );
    const draft = await add('Quillfeather Yard');
    const submitted = await add(NAME);
    await submit(client, submitted, parts.stages[0]);
    return { tenant, draft, submitted };
  });
}

beforeAll(async () => {
  const { host, port, database, password } = databaseSettings('app_api', 4);
  db = createDatabase({
    host,
    port,
    database,
    password,
    role: 'app_api',
    maxConnections: 4,
    applicationName: 'tps-db-tests',
  });
  [a, b] = await Promise.all([addFixture(), addFixture()]);
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

const [entry] = grantsSearch;

const find = (tenant: TestTenant, term: string, audience: 'staff' | 'blind_reviewer' = 'staff') =>
  withTenant(db, trustedTenantId(tenant.id), (tx: Tx) =>
    entry.search(tx)({ term: searchTermSchema.parse(term), audience, limit: 6 }),
  );

describe('the submission search', { timeout: 30_000 }, () => {
  it('finds a submission by part of its organisation’s name, and labels it with the round', async () => {
    const hits = await find(a.tenant, 'quillfeather');
    expect(hits).toEqual([
      {
        kind: 'grants.application',
        id: a.submitted,
        label: expect.stringMatching(new RegExp(`^${NAME}, .+`)) as string,
        module: 'grants',
      },
    ]);
  });

  it('never finds a draft, or another tenant’s submission for the same name', async () => {
    const mine = (await find(a.tenant, 'Quillfeather')).map((hit) => hit.id);
    const theirs = (await find(b.tenant, 'Quillfeather')).map((hit) => hit.id);
    expect(mine).toEqual([a.submitted]);
    expect(theirs).toEqual([b.submitted]);
  });

  it('finds nothing for a name no organisation has, or for a reviewer', async () => {
    expect(await find(a.tenant, 'Marrowby')).toEqual([]);
    expect(await find(a.tenant, NAME, 'blind_reviewer')).toEqual([]);
  });
});
