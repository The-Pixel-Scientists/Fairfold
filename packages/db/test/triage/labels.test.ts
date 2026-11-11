// SPDX-License-Identifier: AGPL-3.0-or-later
//
// grants.label and grants.application_label (migration 0059): denied across
// tenants, the name and colour checks, every key kept in the tenant, labels
// archived and never deleted, an archived label never newly applied, applied
// labels never changed, the database's own times, and read-only for
// app_worker.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import { addApplication } from '../grants/application-fixtures.ts';
import { expectEveryRoleRefused, insertOutcome } from '../notes/fixtures.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  testSlug,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { expectDatabaseTime, expectWorkerReadsOnly } from './fixtures.ts';

const LABEL = 'grants.label';
const APPLIED = 'grants.application_label';

let tenant: TestTenant;
let other: TestTenant;
let member: string;
let application: string;
let second: string;
let label: string;
let strangers: { member: string; application: string; label: string };

const labelRow = (inTenant: TestTenant, name: string, by: string, change: Row = {}): Row => ({
  tenant_id: inTenant.id,
  name,
  created_by: by,
  updated_by: by,
  ...change,
});

const appliedRow = (change: Row = {}): Row => ({
  tenant_id: tenant.id,
  application_id: application,
  label_id: label,
  added_by: member,
  ...change,
});

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  ({ member, application, second, label } = await asMigratorIn(tenant.id, async (client) => {
    const by = await addMember(client, tenant, ['programme_manager']);
    return {
      member: by,
      application: (await addApplication(client, tenant)).id,
      second: (await addApplication(client, tenant)).id,
      label: await insertRow(client, LABEL, labelRow(tenant, 'Label A', by)),
    };
  }));
  strangers = await asMigratorIn(other.id, async (client) => {
    const by = await addMember(client, other);
    return {
      member: by,
      application: (await addApplication(client, other)).id,
      label: await insertRow(client, LABEL, labelRow(other, 'Label B', by)),
    };
  });
}, 60_000);

describe(LABEL, { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(LABEL, async (client, row) =>
      labelRow(row, `Label ${testSlug()}`, await addMember(client, row)),
    ));

  it.each([
    ['a blank name', { name: '   ' }],
    ['an untrimmed name', { name: ' Label C' }],
    ['a name over the limit', { name: 'x'.repeat(41) }],
    ['an unknown colour', { colour: '#ff0000' }],
  ])('refuses %s', async (_name, change) => {
    const row = labelRow(tenant, 'Label C', member, change);
    expect(await insertOutcome('app_api', tenant, LABEL, row)).toBe('23514');
  });

  it('is unique per tenant in any case, and not across tenants', async () => {
    expect(await insertOutcome('app_api', tenant, LABEL, labelRow(tenant, 'LABEL A', member))).toBe(
      '23505',
    );
    const row = labelRow(other, 'Label A', strangers.member, { colour: 'info' });
    expect(await insertOutcome('app_api', other, LABEL, row)).toBe('ok');
  });

  it.each(['created_by', 'updated_by'])("refuses another tenant's member in %s", async (column) => {
    const row = labelRow(tenant, 'Label D', member, { [column]: strangers.member });
    expect(await insertOutcome('app_api', tenant, LABEL, row)).toBe('23503');
  });

  it('is renamed, recoloured and archived by app_api, and deleted by no app role', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const change = `UPDATE ${LABEL} SET name = 'Label E', colour = 'danger', archived = true,
                        updated_by = $2 WHERE id = $1`;
      expect(await outcome(client, change, [label, member])).toBe('ok');
      expect(
        await outcome(client, `UPDATE ${LABEL} SET created_by = created_by WHERE id = $1`, [label]),
      ).toBe('42501');
    });
    await expectEveryRoleRefused(tenant, `DELETE FROM ${LABEL} WHERE id = $1`, [label]);
  });

  it('sets created_at and updated_at itself', async () => {
    const at = { created_at: new Date(0), updated_at: new Date(0) };
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, LABEL, labelRow(tenant, 'Label F', member, at)),
    );
    await expectDatabaseTime(tenant, LABEL, 'created_at', id);
    await asMigratorIn(tenant.id, (client) =>
      client.query(`UPDATE ${LABEL} SET updated_at = $2 WHERE id = $1`, [id, new Date(0)]),
    );
    await expectDatabaseTime(tenant, LABEL, 'updated_at', id);
    const row = labelRow(tenant, 'Label G', member, { created_at: new Date(0) });
    expect(await insertOutcome('app_api', tenant, LABEL, row)).toBe('42501');
    await expectWorkerReadsOnly(tenant, LABEL, id, 'name', labelRow(tenant, 'Label H', member));
  });
});

describe(APPLIED, { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(APPLIED, async (client, row) => {
      const by = await addMember(client, row);
      return {
        tenant_id: row.id,
        application_id: (await addApplication(client, row)).id,
        label_id: await insertRow(client, LABEL, labelRow(row, `Label ${testSlug()}`, by)),
        added_by: by,
      };
    }));

  it.each([
    ['application_id', () => strangers.application],
    ['label_id', () => strangers.label],
    ['added_by', () => strangers.member],
  ])("refuses another tenant's row in %s", async (column, value) => {
    expect(await insertOutcome('app_api', tenant, APPLIED, appliedRow({ [column]: value() }))).toBe(
      '23503',
    );
  });

  it('applies a label once, keeps it when archived, and refuses it once archived', async () => {
    await asRoleIn('app_api', tenant.id, async (client) => {
      const fresh = await insertRow(client, LABEL, labelRow(tenant, 'Label I', member));
      const insert = insertStatement(client, APPLIED, appliedRow({ label_id: fresh }));
      await client.query(insert.text, insert.values);
      expect(await outcome(client, insert.text, insert.values)).toBe('23505');
      const again = await client.query(`${insert.text} ON CONFLICT DO NOTHING`, insert.values);
      expect(again.rowCount).toBe(0);

      await client.query(`UPDATE ${LABEL} SET archived = true WHERE id = $1`, [fresh]);
      const kept = await client.query(`SELECT 1 FROM ${APPLIED} WHERE label_id = $1`, [fresh]);
      expect(kept.rowCount).toBe(1);
      const late = insertStatement(
        client,
        APPLIED,
        appliedRow({ application_id: second, label_id: fresh }),
      );
      expect(await outcome(client, late.text, late.values)).toBe('55000');
    });
  });

  it('is removed by app_api, changed by no app role, and sets added_at itself', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, APPLIED, appliedRow({ added_at: new Date(0) })),
    );
    await expectDatabaseTime(tenant, APPLIED, 'added_at', id);
    expect(
      await insertOutcome('app_api', tenant, APPLIED, appliedRow({ added_at: new Date(0) })),
    ).toBe('42501');
    await expectEveryRoleRefused(
      tenant,
      `UPDATE ${APPLIED} SET label_id = label_id WHERE id = $1`,
      [id],
    );
    await expectWorkerReadsOnly(tenant, APPLIED, id, 'label_id', appliedRow());
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, `DELETE FROM ${APPLIED} WHERE id = $1`, [id])).toBe('ok');
    });
  });
});
