// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The 360Giving export route's handler against the test database as app_api,
// each call in its own tenant transaction. Only identifiers staff have
// verified are published. Organisation names and identifier values here are
// invented and recognisable, so a test can prove that none reaches an audit
// event.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../../../../../packages/db/src/database.ts';
import { trustedTenantId, withTenant } from '../../../../../packages/db/src/tenant-context.ts';
import { databaseSettings } from '../../../../../packages/db/test/connect.ts';
import {
  addReleased,
  publisherRow,
} from '../../../../../packages/db/test/grants/decision-fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type TestTenant,
} from '../../../../../packages/db/test/tenants.ts';
import type { Tx } from '../programme/tables.ts';
import { exportHandlers } from './handlers.ts';

class Refused extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Refused');
    this.status = status;
  }
}

const handlers = exportHandlers({
  notFound: () => new Refused(404),
  refuse: (status) => new Refused(status),
  tenantTimeZone: () => Promise.resolve('Europe/London'),
  recordConfig: () => Promise.resolve(),
});

interface Funder {
  readonly tenant: TestTenant;
  readonly member: string;
  readonly programme: string;
  readonly organisation: string;
}

let db: ReturnType<typeof createDatabase<unknown>>;
let a: Funder;
let b: Funder;

async function fixture(): Promise<Funder> {
  const tenant = await createTestTenant();
  return asMigratorIn(tenant.id, async (client) => {
    const released = await addReleased(client, tenant);
    await insertRow(client, 'grants.publisher_setting', publisherRow(tenant));
    await client.query(
      "UPDATE party.organisation SET name = 'Harbourside Allotment Society' WHERE id = $1",
      [released.parts.organisation],
    );
    return {
      tenant,
      member: await addMember(client, tenant, ['programme_manager']),
      programme: released.programme,
      organisation: released.parts.organisation,
    };
  });
}

const identifier = (funder: Funder, scheme: string, value: string, verified = false) =>
  asMigratorIn(funder.tenant.id, async (client) => {
    const id = await insertRow(client, 'party.organisation_identifier', {
      tenant_id: funder.tenant.id,
      organisation_id: funder.organisation,
      scheme,
      identifier: value,
    });
    if (verified) {
      await client.query(
        'UPDATE party.organisation_identifier SET verified_by = $1 WHERE id = $2',
        [funder.member, id],
      );
    }
    return id;
  });

async function download(funder: Funder, programme = funder.programme) {
  const events: Record<string, unknown>[] = [];
  const context = {
    audit: { record: (event: Record<string, unknown>) => Promise.resolve(void events.push(event)) },
    session: { tenant: funder.tenant.id },
    membership: { id: funder.member },
  };
  const built = await withTenant(db, trustedTenantId(funder.tenant.id), (tx: Tx) =>
    handlers.get360GivingExport({ tx, context, input: { query: { programmeId: programme } } }),
  );
  return { ...built, events };
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
  [a, b] = await Promise.all([fixture(), fixture()]);
}, 60_000);
afterAll(() => db.destroy());

describe('360Giving export identifiers', { timeout: 60_000 }, () => {
  it('publishes an organisation with no verified identifier under the prefix and counts it', async () => {
    await identifier(a, 'GB-CHC', '1000001');
    await identifier(a, 'GB-COH', '01000002');
    const { file, summary, events } = await download(a);

    expect(file.grants[0]?.recipientOrganization).toEqual([
      { id: `360G-northfield-${a.organisation}`, name: 'Harbourside Allotment Society' },
    ]);
    expect(summary).toEqual({
      grants: 1,
      unverifiedRecipients: [{ id: a.organisation, name: 'Harbourside Allotment Society' }],
    });
    expect(events).toMatchObject([{ action: 'grants.export.downloaded' }]);
    expect(JSON.stringify(events)).not.toMatch(/1000001|01000002|Harbourside/);
  });

  it('publishes a verified later scheme, even one verified after the award, without the unverified charity number', async () => {
    await asMigratorIn(a.tenant.id, (client) =>
      client.query(
        "UPDATE party.organisation_identifier SET verified_by = $1 WHERE scheme = 'GB-COH' AND organisation_id = $2",
        [a.member, a.organisation],
      ),
    );
    const { file, summary } = await download(a);

    expect(file.grants[0]?.recipientOrganization).toEqual([
      { id: 'GB-COH-01000002', name: 'Harbourside Allotment Society', companyNumber: '01000002' },
    ]);
    expect(summary.unverifiedRecipients).toEqual([]);
  });

  it('withholds an identifier whose value changed after it was verified', async () => {
    await asMigratorIn(a.tenant.id, (client) =>
      client.query(
        "UPDATE party.organisation_identifier SET identifier = '01000003' WHERE scheme = 'GB-COH' AND organisation_id = $1",
        [a.organisation],
      ),
    );
    const { file, summary } = await download(a);

    expect(file.grants[0]?.recipientOrganization[0]?.id).toBe(`360G-northfield-${a.organisation}`);
    expect(summary.unverifiedRecipients).toHaveLength(1);
  });

  it("does not let another tenant's verified identifier verify this tenant's", async () => {
    await identifier(b, 'GB-CHC', '1000001', true);
    const { file, summary } = await download(a);
    const other = await download(b);

    expect(file.grants[0]?.recipientOrganization[0]?.id).toBe(`360G-northfield-${a.organisation}`);
    expect(summary.unverifiedRecipients).toHaveLength(1);
    expect(other.file.grants[0]?.recipientOrganization[0]?.id).toBe('GB-CHC-1000001');
    expect(other.summary.unverifiedRecipients).toEqual([]);
  });

  it("answers 404 for another tenant's programme", async () => {
    await expect(download(a, b.programme)).rejects.toMatchObject({ status: 404 });
  });
});
