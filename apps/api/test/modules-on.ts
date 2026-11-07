// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Switch a tool on or off for a test tenant, as the operator's backfill would
// (ADR 0024): no tool is on until a row says so. Safe to repeat once the tenant has a member (an update needs a user author).

import {
  asMigratorIn,
  createTestTenant,
  type TestTenant,
} from '../../../packages/db/test/tenants.ts';

export async function switchModule(
  tenant: TestTenant,
  module: string,
  enabled = true,
): Promise<void> {
  await asMigratorIn(tenant.id, (client) =>
    client.query(
      `INSERT INTO app.tenant_module (tenant_id, module, enabled, updated_by_kind)
       VALUES ($1, $2, $3, 'operator')
       ON CONFLICT (tenant_id, module) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             updated_by = (SELECT id FROM app.membership WHERE tenant_id = $1 LIMIT 1)`,
      [tenant.id, module, enabled],
    ),
  );
}

/** A new tenant with grants on, as every existing tenant has after the backfill. */
export async function createGrantsTenant(): Promise<TestTenant> {
  const tenant = await createTestTenant();
  await switchModule(tenant, 'grants');
  return tenant;
}
