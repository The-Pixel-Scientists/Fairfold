// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0067's down.sql refuses, changing nothing, while any impact
// table holds a row, even one that row-level security hides from migrator.
// It runs in a transaction that is always rolled back.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorIn, asRoleIn, createTestTenant } from '../tenants.ts';
import { addImpactParts } from './fixtures.ts';

describe('migration 0067 down', { timeout: 30_000 }, () => {
  it("refuses while impact holds a row, even another tenant's", async () => {
    const down = await readFile(join(MIGRATIONS_FOLDER, '0067_impact_core', 'down.sql'), 'utf8');
    const [tenant, other] = [await createTestTenant(), await createTestTenant()];
    await asMigratorIn(tenant.id, (client) => addImpactParts(client, tenant));
    await asRoleIn('migrator', other.id, async (client) => {
      await expect(client.query(down)).rejects.toThrow(
        'Migration 0067 cannot be rolled back while impact holds rows',
      );
    });
  });
});
