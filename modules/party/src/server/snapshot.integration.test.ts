// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The snapshot contract against the test database, as app_api, with each call
// in its own tenant transaction: what is copied, what is audited, and that
// another tenant's organisation and snapshots are never found.

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../packages/db/test/connect.ts';
import { addOrganisation } from '../../../../packages/db/test/party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../packages/db/test/tenants.ts';
import {
  readOrganisationSnapshot,
  takeOrganisationSnapshot,
  type SnapshotContext,
} from './index.ts';

interface Fixture {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly organisation: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Fixture;
let b: Fixture;

const addFixture = async (): Promise<Fixture> => {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const organisation = await addOrganisation(client, tenant, {
      name: 'Recognisable Trust',
      address_line2: 'Unit 4',
      website: 'https://recognisable.example.org',
    });
    const member = await addMember(client, tenant);
    await insertRow(client, 'party.organisation_identifier', {
      tenant_id: tenant.id,
      organisation_id: organisation,
      scheme: 'GB-CHC',
      identifier: '7654321',
      verified_at: '2026-10-01T09:30:00Z',
      verified_by: member,
    });
    return { tenant, organisation, member };
  });
};

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
});

afterAll(async () => {
  await db.destroy();
});

type Recorded = Parameters<SnapshotContext['audit']['record']>[0];

/** Runs `work` in a tenant transaction with a context that remembers what it audits. */
const inTenant = <T>(
  { tenant, member }: Fixture,
  work: (context: SnapshotContext) => Promise<T>,
): Promise<{ result: T; audited: Recorded[] }> =>
  withTenant(db, trustedTenantId(tenant.id), async (tx) => {
    const audited: Recorded[] = [];
    const audit = { record: (event: Recorded) => Promise.resolve(void audited.push(event)) };
    return { result: await work({ tx, membership: { id: member }, audit }), audited };
  });

describe('takeOrganisationSnapshot', () => {
  it('copies the organisation as it is, for the member, and audits ids only', async () => {
    const { result: id, audited } = await inTenant(a, (context) =>
      takeOrganisationSnapshot(context, a.organisation),
    );

    expect(audited).toEqual([
      {
        action: 'party.organisation_snapshot.created',
        entityId: id,
        changes: {
          'party.organisation_snapshot.id': { after: id },
          'party.organisation_snapshot.organisation_id': { after: a.organisation },
        },
      },
    ]);
    expect(JSON.stringify(audited)).not.toMatch(/Recognisable|High Street|7654321/);

    const { result: read } = await inTenant(a, (context) => readOrganisationSnapshot(context, id));
    const { takenAt, ...fields } = read ?? {};
    expect(takenAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(fields).toEqual({
      id,
      organisationId: a.organisation,
      name: 'Recognisable Trust',
      legalForm: 'community_benefit_society',
      registeredAddress: {
        line1: '1 High Street',
        line2: 'Unit 4',
        town: 'Northfield',
        postcode: 'NF1 2AB',
        countryCode: 'GB',
      },
      website: 'https://recognisable.example.org',
      identifiers: [
        { scheme: 'GB-CHC', identifier: '7654321', verifiedAt: '2026-10-01T09:30:00.000000Z' },
      ],
      takenBy: a.member,
    });
  });

  it('refuses another tenant’s organisation, and leaves no snapshot and no audit event', async () => {
    await expect(
      inTenant(a, (context) => takeOrganisationSnapshot(context, b.organisation)),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      inTenant(b, (context) => takeOrganisationSnapshot(context, randomUUID())),
    ).rejects.toMatchObject({ code: '23503' });
    const count = await asMigratorIn(b.tenant.id, async (client) =>
      client.query('SELECT 1 FROM party.organisation_snapshot WHERE organisation_id = $1', [
        b.organisation,
      ]),
    );
    expect(count.rowCount).toBe(0);
  });
});

describe('readOrganisationSnapshot', () => {
  it('answers another tenant’s snapshot and an unknown id exactly alike', async () => {
    const { result: id } = await inTenant(a, (context) =>
      takeOrganisationSnapshot(context, a.organisation),
    );

    const foreign = await inTenant(b, (context) => readOrganisationSnapshot(context, id));
    const unknown = await inTenant(b, (context) => readOrganisationSnapshot(context, randomUUID()));
    expect(foreign.result).toBeNull();
    expect(unknown.result).toBeNull();
  });
});
