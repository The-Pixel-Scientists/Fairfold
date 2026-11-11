// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The applicant contact read for assure against the test database, as app_api
// in a tenant's transaction: ids only, nothing for a draft, nothing while
// grants is switched off, and nothing of another tenant.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import {
  addApplication,
  submit,
} from '../../../../packages/db/test/grants/application-fixtures.ts';
import {
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import { readApplicantContact } from './applicant-contact.ts';
import type { Tx } from './programme/tables.ts';

interface Fixture {
  readonly tenant: TestTenant;
  readonly draft: string;
  readonly submitted: string;
  readonly person: string;
  readonly organisation: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

const switchGrants = (tenant: TestTenant, enabled: boolean) =>
  asMigratorIn(tenant.id, (client) =>
    client.query(
      `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by_kind)
       VALUES ($1, 'grants', $2, 'operator')
       ON CONFLICT (tenant_id, module) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             updated_by = (SELECT id FROM app.membership WHERE tenant_id = $1 LIMIT 1)`,
      [tenant.id, enabled],
    ),
  );

async function addFixture(): Promise<Fixture> {
  const tenant = await createTestTenant();
  await switchGrants(tenant, true);
  return asMigratorIn(tenant.id, async (client) => {
    const draft = await addApplication(client, tenant);
    const submitted = await addApplication(client, tenant);
    await submit(client, submitted.id, submitted.parts.stages[0]);
    return {
      tenant,
      draft: draft.id,
      submitted: submitted.id,
      person: submitted.parts.person,
      organisation: submitted.parts.organisation,
    };
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

const read = (tenant: TestTenant, applicationId: string) =>
  withTenant(db, trustedTenantId(tenant.id), (tx: Tx) => readApplicantContact(tx, applicationId));

describe('readApplicantContact', { timeout: 30_000 }, () => {
  it('returns the application, its organisation and the person who applied, as ids', async () => {
    expect(await read(a.tenant, a.submitted)).toEqual({
      applicationId: a.submitted,
      organisationId: a.organisation,
      applicantPersonId: a.person,
    });
  });

  it('returns nothing for a draft, or an application that does not exist', async () => {
    expect(await read(a.tenant, a.draft)).toBeNull();
    expect(await read(a.tenant, randomUUID())).toBeNull();
  });

  it("returns nothing for another tenant's application, even when asked for by id", async () => {
    expect(await read(a.tenant, b.submitted)).toBeNull();
    expect(await read(b.tenant, a.submitted)).toBeNull();
    expect((await read(b.tenant, b.submitted))?.organisationId).toBe(b.organisation);
  });

  it('returns nothing while grants is switched off, or has no switch, and again once on', async () => {
    const bare = await createTestTenant();
    expect(await read(bare, a.submitted)).toBeNull();
    await switchGrants(a.tenant, false);
    expect(await read(a.tenant, a.submitted)).toBeNull();
    await switchGrants(a.tenant, true);
    expect(await read(a.tenant, a.submitted)).not.toBeNull();
  });
});
