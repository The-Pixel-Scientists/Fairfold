// SPDX-License-Identifier: AGPL-3.0-or-later
//
// assure.lookup_snapshot and assure.lookup_officer (migration 0054): denied
// across tenants, structured and checked, append-only snapshots whose time
// is the database's, written by app_worker alone, and officers linked to a
// person once, by a member, never on insert.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { expectEveryRoleRefused, insertOutcome } from '../notes/fixtures.ts';
import { addOrganisation, addPerson } from '../party/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { addList, addSnapshot, officerRow, snapshotRow } from './fixtures.ts';

let tenant: TestTenant;
let organisation: string;
let snapshot: string;
let officer: string;
let person: string;
let member: string;
let strangers: { organisation: string; snapshot: string; person: string; member: string };

beforeAll(async () => {
  tenant = await createTestTenant();
  const stranger = await createTestTenant();
  await asMigratorIn(tenant.id, async (client) => {
    ({ organisation, snapshot } = await addSnapshot(client, tenant));
    officer = await insertRow(client, 'assure.lookup_officer', officerRow(tenant, snapshot));
    person = await addPerson(client, tenant);
    member = await addMember(client, tenant, ['programme_manager']);
  });
  strangers = await asMigratorIn(stranger.id, async (client) => ({
    ...(await addSnapshot(client, stranger)),
    person: await addPerson(client, stranger),
    member: await addMember(client, stranger),
  }));
}, 60_000);

const workerInsert = (table: string, row: Record<string, unknown>) =>
  insertOutcome('app_worker', tenant, table, row);

describe('assure.lookup_snapshot', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.lookup_snapshot', async (client, row) =>
      snapshotRow(row, await addOrganisation(client, row)),
    ));

  it("refuses another tenant's organisation", async () => {
    expect(
      await workerInsert('assure.lookup_snapshot', snapshotRow(tenant, strangers.organisation)),
    ).toBe('23503');
  });

  it('is written by app_worker, never app_api', async () => {
    expect(await workerInsert('assure.lookup_snapshot', snapshotRow(tenant, organisation))).toBe(
      'ok',
    );
    expect(
      await insertOutcome(
        'app_api',
        tenant,
        'assure.lookup_snapshot',
        snapshotRow(tenant, organisation),
      ),
    ).toBe('42501');
  });

  it.each([
    ['an identifier in another scheme format', { identifier: 'SC012345' }],
    ['a scheme the register does not serve', { scheme: 'GB-COH' }],
    ['a register outside the list', { registry: 'charity_commission_ni' }],
    ['a status outside the list', { registry_status: 'struck_off' }],
    ['a found entry without a name', { registered_name: null }],
    ['part of an address', { address_town: null }],
    ['income without a currency', { accounts_period_end: '2026-03-31', income_minor: 100 }],
    [
      'negative income',
      { accounts_period_end: '2026-03-31', income_minor: -1, income_currency: 'GBP' },
    ],
    ['overdue accounts for a charity', { accounts_overdue: true }],
    ['a register download for an API register', { list_id: 'list' }],
  ])('refuses %s', async (_name, change) => {
    const list = await asMigratorIn(tenant.id, (client) =>
      addList(client, { source: 'oscr_register' }),
    );
    const row = snapshotRow(tenant, organisation, change);
    const listed = 'list_id' in change ? { ...row, list_id: list } : row;
    expect(await workerInsert('assure.lookup_snapshot', listed)).toBe('23514');
  });

  it('holds no details for an identifier the register does not know', async () => {
    const notFound = {
      outcome: 'not_found',
      registry_status: null,
      registered_name: null,
      address_line1: null,
      address_town: null,
      address_postcode: null,
      address_country_code: null,
    };
    expect(
      await workerInsert('assure.lookup_snapshot', snapshotRow(tenant, organisation, notFound)),
    ).toBe('ok');
    expect(
      await workerInsert(
        'assure.lookup_snapshot',
        snapshotRow(tenant, organisation, { ...notFound, registered_name: 'Synthetic Charity' }),
      ),
    ).toBe('23514');
  });

  it('records an OSCR lookup against the register download it read', async () => {
    const list = await asMigratorIn(tenant.id, (client) =>
      addList(client, { source: 'oscr_register' }),
    );
    const oscr = { registry: 'oscr', scheme: 'GB-SC', identifier: 'SC012345' };
    expect(
      await workerInsert(
        'assure.lookup_snapshot',
        snapshotRow(tenant, organisation, { ...oscr, list_id: list }),
      ),
    ).toBe('ok');
    expect(
      await workerInsert('assure.lookup_snapshot', snapshotRow(tenant, organisation, oscr)),
    ).toBe('23514');
  });

  it('sets its own fetch time, whatever the caller sends', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(
        client,
        'assure.lookup_snapshot',
        snapshotRow(tenant, organisation, { fetched_at: new Date(0) }),
      ),
    );
    await asMigratorIn(tenant.id, async (client) => {
      const { rows } = await client.query<{ fetched_at: Date }>(
        'SELECT fetched_at FROM assure.lookup_snapshot WHERE id = $1',
        [id],
      );
      expect(rows[0]?.fetched_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
  });

  it('is append-only for every app role', async () => {
    for (const statement of [
      'UPDATE assure.lookup_snapshot SET registered_name = registered_name WHERE id = $1',
      'DELETE FROM assure.lookup_snapshot WHERE id = $1',
    ]) {
      await expectEveryRoleRefused(tenant, statement, [snapshot]);
    }
  });

  it('finds the newest snapshot per organisation and register through its index', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM assure.lookup_snapshot
          WHERE organisation_id = $1 AND registry = 'charity_commission'
          ORDER BY fetched_at DESC LIMIT 1`,
        [organisation],
      );
      expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain('lookup_snapshot_latest');
    });
  });
});

describe('assure.lookup_officer', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('assure.lookup_officer', async (client, row) =>
      officerRow(row, (await addSnapshot(client, row)).snapshot),
    ));

  it("refuses another tenant's snapshot, and a person on insert", async () => {
    expect(
      await workerInsert('assure.lookup_officer', officerRow(tenant, strangers.snapshot)),
    ).toBe('23503');
    expect(
      await asMigratorIn(tenant.id, (client) =>
        outcome(
          client,
          `INSERT INTO assure.lookup_officer (tenant_id, snapshot_id, name, role, person_id)
           VALUES ($1, $2, 'Synthetic Name', 'trustee', $3)`,
          [tenant.id, snapshot, person],
        ),
      ),
    ).toBe('23514');
  });

  it('is linked by app_api once, to a person and member of its own tenant', async () => {
    const LINK = 'UPDATE assure.lookup_officer SET person_id = $2, linked_by = $3 WHERE id = $1';
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, LINK, [officer, strangers.person, member])).toBe('23503');
      expect(await outcome(client, LINK, [officer, person, strangers.member])).toBe('23503');
      expect(await outcome(client, LINK, [officer, person, null])).toBe('23514');
      await client.query(LINK, [officer, person, member]);
      const { rows } = await client.query<{ linked_at: Date | null }>(
        'SELECT linked_at FROM assure.lookup_officer WHERE id = $1',
        [officer],
      );
      expect(rows[0]?.linked_at).toBeInstanceOf(Date);
      expect(await outcome(client, LINK, [officer, await otherPerson(), member])).toBe('55000');
      expect(
        await outcome(client, 'UPDATE assure.lookup_officer SET name = $2 WHERE id = $1', [
          officer,
          'Changed',
        ]),
      ).toBe('42501');
    });
  });

  it('is never deleted by an app role', async () => {
    await expectEveryRoleRefused(tenant, 'DELETE FROM assure.lookup_officer WHERE id = $1', [
      officer,
    ]);
  });
});

/** Another person in the tenant, committed. */
function otherPerson(): Promise<string> {
  return asMigratorIn(tenant.id, (client) => addPerson(client, tenant));
}
