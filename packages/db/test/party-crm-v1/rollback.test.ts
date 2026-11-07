// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0020's down.sql refuses, changing nothing, while a party is
// merged, since dropping merged_into would lose its survivor. It runs in a
// transaction that is always rolled back.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { addParty } from '../party/fixtures.ts';
import { asRoleIn, createTestTenant } from '../tenants.ts';

describe('migration 0020 down', { timeout: 30_000 }, () => {
  it('refuses while a party is merged', async () => {
    const down = await readFile(join(MIGRATIONS_FOLDER, '0020_party_crm_v1', 'down.sql'), 'utf8');
    const tenant = await createTestTenant();
    await asRoleIn('migrator', tenant.id, async (client) => {
      const loser = await addParty(client, tenant, 'person');
      const survivor = await addParty(client, tenant, 'person');
      await client.query(
        "UPDATE party.party SET status = 'merged', merged_into = $2 WHERE id = $1",
        [loser, survivor],
      );
      await expect(client.query(down)).rejects.toThrow(
        'Migration 0020 cannot be rolled back while a party is merged',
      );
    });
  });
});
