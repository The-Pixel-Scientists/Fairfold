// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.tag (migration 0052): denied across tenants, its label checks, unique
// in a tenant in any case, renamed by app_api and removed by no app role.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import { expectEveryRoleRefused, insertOutcome } from './fixtures.ts';

let tenant: TestTenant;
let other: TestTenant;
let member: string;
let otherMember: string;

const tagRow = (inTenant: TestTenant, label: string, by: string) => ({
  tenant_id: inTenant.id,
  label,
  created_by: by,
});

beforeAll(async () => {
  tenant = await createTestTenant();
  other = await createTestTenant();
  member = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
  otherMember = await asMigratorIn(other.id, (client) => addMember(client, other));
}, 60_000);

describe('app.tag', { timeout: 30_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial('app.tag', async (client, row) =>
      tagRow(row, `Label ${row.slug}`, await addMember(client, row)),
    ));

  it.each([
    ['blank', '   '],
    ['untrimmed', ' Priority'],
    ['over the limit', 'x'.repeat(41)],
  ])('refuses a label that is %s', async (_name, label) => {
    expect(await insertOutcome('app_api', tenant, 'app.tag', tagRow(tenant, label, member))).toBe(
      '23514',
    );
  });

  it('is unique per tenant in any case, and not across tenants', async () => {
    await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.tag', tagRow(tenant, 'Priority', member)),
    );
    expect(
      await insertOutcome('app_api', tenant, 'app.tag', tagRow(tenant, 'PRIORITY', member)),
    ).toBe('23505');
    expect(
      await insertOutcome('app_api', other, 'app.tag', tagRow(other, 'Priority', otherMember)),
    ).toBe('ok');
  });

  it("refuses another tenant's member as creator", async () => {
    expect(
      await insertOutcome('app_api', tenant, 'app.tag', tagRow(tenant, 'Stranger', otherMember)),
    ).toBe('23503');
  });

  it('lets app_api rename a tag, and change nothing else or delete it', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, 'app.tag', tagRow(tenant, 'Renamed', member)),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, "UPDATE app.tag SET label = 'Fresh' WHERE id = $1", [id])).toBe(
        'ok',
      );
      expect(
        await outcome(client, 'UPDATE app.tag SET created_by = created_by WHERE id = $1', [id]),
      ).toBe('42501');
    });
    await expectEveryRoleRefused(tenant, 'DELETE FROM app.tag WHERE id = $1', [id]);
  });
});
