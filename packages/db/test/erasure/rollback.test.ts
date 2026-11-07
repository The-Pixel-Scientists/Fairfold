// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0033's down.sql refuses, changing nothing, while a party is
// erased, since erased data cannot be restored. It runs in a transaction
// that is always rolled back.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { addPerson } from '../party/fixtures.ts';
import { addMember, asMigratorIn, asRoleIn, createTestTenant } from '../tenants.ts';
import { addErasureRequest, erase } from './fixtures.ts';

describe('migration 0033 down', { timeout: 30_000 }, () => {
  it('refuses while a party is erased', async () => {
    const down = await readFile(join(MIGRATIONS_FOLDER, '0033_party_erasure', 'down.sql'), 'utf8');
    const tenant = await createTestTenant();
    const [person, request] = await asMigratorIn(tenant.id, async (client) => {
      const id = await addPerson(client, tenant);
      return [id, await addErasureRequest(client, tenant, await addMember(client, tenant), id)];
    });
    expect((await erase(tenant, person, request)).code).toBeUndefined();
    await asRoleIn('migrator', tenant.id, async (client) => {
      await expect(client.query(down)).rejects.toThrow(
        'Migration 0033 cannot be rolled back while a party is erased',
      );
    });
  });
});
