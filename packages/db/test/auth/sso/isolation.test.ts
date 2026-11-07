// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tenant isolation of SSO (migration 0027): the cross-tenant denial test on
// each new table, SSO identities in auth.account seen only in their own
// tenant, and no app role but app_auth reaching any of them.

import { describe, expect, it } from 'vitest';

import { withClient } from '../../connect.ts';
import { expectCrossTenantDenial } from '../../cross-tenant.ts';
import { addTestTenant, asRoleIn, committedIn, insertRow, outcome } from '../../tenants.ts';
import { addUser } from '../fixtures.ts';
import { addProvider, domainClaim, removeProviders, samlProvider } from './fixtures.ts';

const TABLES = ['auth.sso_provider', 'auth.sso_domain', 'auth.saml_replay'] as const;

describe('SSO tenant isolation', { timeout: 60_000 }, () => {
  it("keeps each tenant's providers from every other tenant", async () => {
    await expectCrossTenantDenial('auth.sso_provider', samlProvider);
  });

  it("keeps each tenant's domains from every other tenant", async () => {
    await expectCrossTenantDenial('auth.sso_domain', (client, tenant) =>
      domainClaim(client, tenant),
    );
  });

  it("keeps each tenant's used assertion ids from every other tenant", async () => {
    // Expired, so app_auth may delete its own tenant's row.
    await expectCrossTenantDenial('auth.saml_replay', async (client, tenant) => ({
      tenant_id: tenant.id,
      provider_id: (await addProvider(client, tenant)).id,
      assertion_id: '_a1b2c3',
      created_at: new Date(Date.now() - 7_200_000),
      expires_at: new Date(Date.now() - 3_600_000),
    }));
  });

  it.each(['app_api', 'app_worker', 'app_queue'] as const)(
    'gives %s no right on any SSO table',
    async (role) => {
      await withClient('migrator', async (migrator) => {
        const tenant = await addTestTenant(migrator);
        await asRoleIn(role, tenant.id, async (client) => {
          for (const table of TABLES) {
            expect(await outcome(client, `SELECT 1 FROM ${table}`), table).toBe('42501');
            expect(await outcome(client, `DELETE FROM ${table}`), table).toBe('42501');
          }
          expect(await outcome(client, 'SELECT 1 FROM auth.account')).toBe('42501');
        });
      });
    },
  );

  it("shows app_auth only its tenant's SSO identities, and lets it change none of another's", async () => {
    await withClient('migrator', async (migrator) => {
      const tenantA = await addTestTenant(migrator);
      const tenantB = await addTestTenant(migrator);
      const identity = (tenant: typeof tenantA) =>
        committedIn(migrator, tenant.id, async (client) => {
          const { id } = await addProvider(client, tenant);
          const accountId = await insertRow(client, 'auth.account', {
            user_id: await addUser(client),
            account_id: 'subject-1',
            provider_id: id,
          });
          return { provider: id, account: accountId };
        });
      const a = await identity(tenantA);
      const b = await identity(tenantB);

      await asRoleIn('app_auth', tenantB.id, async (client) => {
        const count = async (id: string) =>
          (await client.query('SELECT 1 FROM auth.account WHERE id = $1', [id])).rowCount;
        expect(await count(b.account), "B's own identity").toBe(1);
        expect(await count(a.account), "A's identity").toBe(0);
        const changed = await client.query(
          'UPDATE auth.account SET password = password WHERE id = $1',
          [a.account],
        );
        expect(changed.rowCount, "updating A's identity").toBe(0);
        expect(await outcome(client, 'DELETE FROM auth.account WHERE id = $1', [a.account])).toBe(
          '42501',
        );
        const userId = await addUser(client);
        const insert = `INSERT INTO auth.account (user_id, account_id, provider_id) VALUES ($1, 'subject-2', $2)`;
        expect(await outcome(client, insert, [userId, a.provider]), "adding to A's provider").toBe(
          '23514',
        );
        expect(await outcome(client, insert, [userId, b.provider]), "adding to B's own").toBe('ok');
      });

      await withClient('app_auth', async (client) => {
        const { rowCount } = await client.query(
          'SELECT 1 FROM auth.account WHERE id = ANY ($1::uuid[])',
          [[a.account, b.account]],
        );
        expect(rowCount, 'identities with no tenant set').toBe(0);
      });
      await removeProviders(tenantA);
      await removeProviders(tenantB);
    });
  });
});
