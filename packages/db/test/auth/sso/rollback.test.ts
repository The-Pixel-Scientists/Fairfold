// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0027's down.sql refuses, changing nothing, while auth.account
// holds an SSO identity, which no schema before 0027 can hold. The case runs
// in a transaction that is always rolled back, on a committed tenant.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../../scripts/migrations.ts';
import { withClient } from '../../connect.ts';
import { addTestTenant, insertRow } from '../../tenants.ts';
import { addUser } from '../fixtures.ts';
import { addProvider } from './fixtures.ts';

describe('migration 0027 down', { timeout: 30_000 }, () => {
  it('refuses while an SSO identity exists', async () => {
    const sql = await readFile(join(MIGRATIONS_FOLDER, '0027_auth_sso', 'down.sql'), 'utf8');
    await withClient('migrator', async (client) => {
      const tenant = await addTestTenant(client);
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant.id]);
        const { id } = await addProvider(client, tenant);
        await insertRow(client, 'auth.account', {
          user_id: await addUser(client),
          account_id: 'subject',
          provider_id: id,
        });
        await client.query('SAVEPOINT down');
        await expect(client.query(sql)).rejects.toThrow(
          'Migration 0027 cannot be rolled back: auth.account holds SSO identities.',
        );
        await client.query('ROLLBACK TO SAVEPOINT down');
        const { rowCount } = await client.query('SELECT 1 FROM auth.sso_provider WHERE id = $1', [
          id,
        ]);
        expect(rowCount).toBe(1);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});
