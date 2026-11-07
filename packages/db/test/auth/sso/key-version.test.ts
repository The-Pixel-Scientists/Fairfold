// SPDX-License-Identifier: AGPL-3.0-or-later
//
// auth.sso_providers_by_key_version() (migration 0027, ADR 0003's approved
// definer functions): app_auth alone may call it, it returns ids and tenant
// ids from every tenant whatever the tenant's status, and its owner can read
// no other column of auth.sso_provider.

import { describe, expect, it } from 'vitest';

import { asMigratorRolledBack, withClient } from '../../connect.ts';
import { addTestTenant, committedIn, insertRow, outcome } from '../../tenants.ts';
import { oidcProvider } from './fixtures.ts';

const VERSION = 7;

describe('auth.sso_providers_by_key_version()', { timeout: 30_000 }, () => {
  it('returns the providers each key version sealed, in every tenant', async () => {
    const made = await withClient('migrator', async (migrator) => {
      const ids: { id: string; tenant_id: string }[] = [];
      for (const version of [VERSION, VERSION, VERSION + 1]) {
        const tenant = await addTestTenant(migrator);
        const id = await committedIn(migrator, tenant.id, async (client) =>
          insertRow(client, 'auth.sso_provider', await oidcProvider(client, tenant, version)),
        );
        if (version === VERSION) ids.push({ id, tenant_id: tenant.id });
      }
      // A suspended tenant's secrets are re-encrypted too.
      await committedIn(migrator, ids[0]?.tenant_id ?? '', (client) =>
        client.query("UPDATE app.tenant SET status = 'suspended' WHERE id = $1", [
          ids[0]?.tenant_id,
        ]),
      );
      return ids;
    });
    await withClient('app_auth', async (client) => {
      const { rows } = await client.query<{ id: string; tenant_id: string }>(
        'SELECT id, tenant_id FROM auth.sso_providers_by_key_version($1)',
        [VERSION],
      );
      expect(rows).toEqual(expect.arrayContaining(made));
      expect(Object.keys(rows[0] ?? {})).toEqual(['id', 'tenant_id']);
    });
  });

  it.each(['app_api', 'app_worker', 'app_queue'] as const)('refuses %s', async (role) => {
    await withClient(role, async (client) => {
      await client.query('BEGIN');
      expect(await outcome(client, 'SELECT * FROM auth.sso_providers_by_key_version(1)')).toBe(
        '42501',
      );
    });
  });

  it('lets its owner read only the id, tenant and key version', async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query('SET LOCAL ROLE owner_auth_sso_providers_by_key_version');
      expect(
        await outcome(client, 'SELECT id, tenant_id, key_version FROM auth.sso_provider'),
      ).toBe('ok');
      for (const column of ['client_secret', 'sp_private_key', 'name', 'issuer']) {
        expect(await outcome(client, `SELECT ${column} FROM auth.sso_provider`), column).toBe(
          '42501',
        );
      }
      expect(await outcome(client, 'DELETE FROM auth.sso_provider')).toBe('42501');
    });
  });
});
