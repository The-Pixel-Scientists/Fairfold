// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The down.sql of migrations 0089 to 0091 each refuse, changing nothing,
// while one of their tables holds a row, even one that row-level security
// hides from migrator. Each runs in a transaction that is always rolled back.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorIn, asRoleIn, createTestTenant, type TestTenant } from '../tenants.ts';
import { addPrivacyParts } from './fixtures.ts';

let other: TestTenant;
beforeAll(async () => {
  const tenant = await createTestTenant();
  await asMigratorIn(tenant.id, (client) => addPrivacyParts(client, tenant));
  other = await createTestTenant();
}, 30_000);

describe('the privacy migrations down', { timeout: 30_000 }, () => {
  it.each([
    ['0089_privacy_core', 'rights requests'],
    ['0090_privacy_breach', 'breaches'],
    ['0091_privacy_register', 'DPIAs, activities or processors'],
  ])("%s refuses while its tables hold a row, even another tenant's", async (folder, what) => {
    const down = await readFile(join(MIGRATIONS_FOLDER, folder, 'down.sql'), 'utf8');
    await asRoleIn('migrator', other.id, async (client) => {
      await expect(client.query(down)).rejects.toThrow(
        `Migration ${folder.slice(0, 4)} cannot be rolled back while ${what} hold rows`,
      );
    });
  });
});
