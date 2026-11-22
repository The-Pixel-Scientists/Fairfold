// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0080's down.sql refuses, changing nothing, while any insight
// table holds a row, even one that row-level security hides from migrator.
// It runs in a transaction that is always rolled back.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { addMember, asMigratorIn, asRoleIn, createTestTenant, insertRow } from '../tenants.ts';
import { ruleRow } from './fixtures.ts';

describe('migration 0080 down', { timeout: 30_000 }, () => {
  it("refuses while insight holds a row, even another tenant's", async () => {
    const down = await readFile(join(MIGRATIONS_FOLDER, '0080_insight_core', 'down.sql'), 'utf8');
    const [tenant, other] = [await createTestTenant(), await createTestTenant()];
    await asMigratorIn(tenant.id, async (client) =>
      insertRow(
        client,
        'insight.disclosure_rule',
        ruleRow(tenant, await addMember(client, tenant)),
      ),
    );
    await asRoleIn('migrator', other.id, async (client) => {
      await expect(client.query(down)).rejects.toThrow(
        'Migration 0080 cannot be rolled back while insight holds rows',
      );
    });
  });
});
