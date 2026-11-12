// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0063's down.sql refuses, changing nothing, while any crm table
// holds a row, even one that row-level security hides from migrator. It
// runs in a transaction that is always rolled back.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorIn, asRoleIn, createTestTenant, insertRow } from '../tenants.ts';
import { addCrmParts, listRow } from './fixtures.ts';

describe('migration 0063 down', { timeout: 30_000 }, () => {
  it("refuses while crm holds a row, even another tenant's", async () => {
    const down = await readFile(join(MIGRATIONS_FOLDER, '0063_crm_core', 'down.sql'), 'utf8');
    const [tenant, other] = [await createTestTenant(), await createTestTenant()];
    await asMigratorIn(tenant.id, async (client) => {
      const { member } = await addCrmParts(client, tenant);
      await insertRow(client, 'crm.list', listRow(tenant, member));
    });
    await asRoleIn('migrator', other.id, async (client) => {
      await expect(client.query(down)).rejects.toThrow(
        'Migration 0063 cannot be rolled back while crm holds rows',
      );
    });
  });
});
