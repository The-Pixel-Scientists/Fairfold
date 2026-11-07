// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The checks of migration 0027: a provider's settings match its kind, a
// verified domain belongs to one tenant at a time while pending claims
// block nobody, an SSO identity takes its tenant from its provider and keeps
// it, and credential accounts stay as they were. Each case runs as app_auth
// in a transaction that is rolled back, on fixtures committed as migrator.

import { describe, expect, it } from 'vitest';

import { withClient } from '../../connect.ts';
import {
  addTestTenant,
  asRoleIn,
  committedIn,
  insertRow,
  insertStatement,
  outcome,
  testSlug,
  type Row,
  type TestTenant,
} from '../../tenants.ts';
import { addUser } from '../fixtures.ts';
import {
  addProvider,
  domainClaim,
  oidcProvider,
  removeProviders,
  samlProvider,
} from './fixtures.ts';

/** A committed tenant, and a row the factory makes for it. */
async function fixture<T>(
  make: (client: Parameters<typeof samlProvider>[0], tenant: TestTenant) => Promise<T>,
) {
  return withClient('migrator', async (migrator) => {
    const tenant = await addTestTenant(migrator);
    return { tenant, made: await committedIn(migrator, tenant.id, (c) => make(c, tenant)) };
  });
}

async function insertAs(tenant: string, table: string, row: Row): Promise<string> {
  return asRoleIn('app_auth', tenant, async (client) => {
    const { text, values } = insertStatement(client, table, row);
    return outcome(client, text, values);
  });
}

describe('auth.sso_provider', { timeout: 30_000 }, () => {
  it('accepts an OIDC and a SAML provider', async () => {
    const { tenant, made } = await fixture(async (c, t) => [
      await oidcProvider(c, t),
      await samlProvider(c, t),
    ]);
    for (const row of made) expect(await insertAs(tenant.id, 'auth.sso_provider', row)).toBe('ok');
  });

  it.each([
    ['an unknown kind', { kind: 'ldap' }],
    ['an OIDC provider without its secret', { client_secret: null, key_version: null }],
    ['a secret without its key version', { key_version: null }],
    ['an issuer that is not HTTPS', { issuer: 'http://login.example.test' }],
    ['a SAML column on an OIDC provider', { entity_id: 'https://idp.example.test' }],
    ['more than 10 MFA values', { mfa_amr: Array.from({ length: 11 }, (_, i) => `v${String(i)}`) }],
    ['ciphertext too short to hold a nonce and tag', { client_secret: Buffer.alloc(28) }],
  ])('refuses %s', async (_, change) => {
    const { tenant, made } = await fixture(oidcProvider);
    expect(await insertAs(tenant.id, 'auth.sso_provider', { ...made, ...change })).toBe('23514');
  });

  it.each([
    [
      'text that is not a certificate',
      { certificates: ['-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----'] },
    ],
    ['no certificate', { certificates: [] }],
    ['a signing key without its certificate', { sp_private_key: Buffer.alloc(64), key_version: 1 }],
  ])('refuses a SAML provider with %s', async (_, change) => {
    const { tenant, made } = await fixture(samlProvider);
    expect(await insertAs(tenant.id, 'auth.sso_provider', { ...made, ...change })).toBe('23514');
  });

  it('lets app_auth change neither kind nor tenant', async () => {
    const { tenant, made } = await fixture(addProvider);
    await asRoleIn('app_auth', tenant.id, async (client) => {
      for (const set of ["kind = 'oidc'", 'tenant_id = tenant_id', 'created_by = created_by']) {
        expect(
          await outcome(client, `UPDATE auth.sso_provider SET ${set} WHERE id = $1`, [made.id]),
          set,
        ).toBe('42501');
      }
    });
  });

  it('removes a provider with its domains, assertion ids and identities', async () => {
    const { tenant, made } = await fixture(async (client, t) => {
      const claim = await domainClaim(client, t);
      await insertRow(client, 'auth.sso_domain', claim);
      const provider = String(claim.provider_id);
      await client.query(
        `INSERT INTO auth.saml_replay (tenant_id, provider_id, assertion_id, expires_at)
         VALUES ($1, $2, '_x', now() + interval '5 minutes')`,
        [t.id, provider],
      );
      await insertRow(client, 'auth.account', {
        user_id: await addUser(client),
        account_id: 'subject',
        provider_id: provider,
      });
      return provider;
    });
    await asRoleIn('app_auth', tenant.id, async (client) => {
      await client.query('DELETE FROM auth.sso_provider WHERE id = $1', [made]);
      for (const [table, column] of [
        ['auth.sso_domain', 'provider_id'],
        ['auth.saml_replay', 'provider_id'],
        ['auth.account', 'sso_provider_id'],
      ] as const) {
        const { rowCount } = await client.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [
          made,
        ]);
        expect(rowCount, table).toBe(0);
      }
    });
    await removeProviders(tenant);
  });
});

describe('auth.sso_domain', { timeout: 30_000 }, () => {
  it('lets a domain be verified in one tenant at a time, while pending claims block nobody', async () => {
    const domain = `${testSlug()}.example.test`;
    const verify = (tenant: string, id: string) =>
      asRoleIn('app_auth', tenant, (client) =>
        outcome(
          client,
          "UPDATE auth.sso_domain SET state = 'verified', verified_at = now() WHERE id = $1",
          [id],
        ),
      );
    const claim = () =>
      fixture(async (client, tenant) =>
        insertRow(client, 'auth.sso_domain', await domainClaim(client, tenant, domain)),
      );
    const a = await claim();
    const b = await claim();
    expect(await verify(b.tenant.id, b.made), 'B verifies first').toBe('ok');
    // Commit B's verification, then A's proof meets it.
    await withClient('migrator', (migrator) =>
      committedIn(migrator, b.tenant.id, (client) =>
        client.query(
          "UPDATE auth.sso_domain SET state = 'verified', verified_at = now() WHERE id = $1",
          [b.made],
        ),
      ),
    );
    expect(await verify(a.tenant.id, a.made), 'A verifies after B').toBe('23505');
    // A third tenant may still claim it; only verifying conflicts.
    expect((await claim()).made).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['upper case', 'Example.ORG'],
    ['a trailing dot', 'example.org.'],
    ['a wildcard', '*.example.org'],
    ['an IP address', '192.0.2.1'],
    ['a single label', 'localhost'],
    ['a Unicode label', 'bücher.example'],
  ])('refuses a domain with %s', async (_, domain) => {
    const { tenant, made } = await fixture((client, t) => domainClaim(client, t, domain));
    expect(await insertAs(tenant.id, 'auth.sso_domain', made)).toBe('23514');
  });

  it('refuses a verified state without its time, and a token that is not 32 random bytes', async () => {
    const { tenant, made } = await fixture(domainClaim);
    expect(await insertAs(tenant.id, 'auth.sso_domain', { ...made, dns_token: 'short' })).toBe(
      '23514',
    );
    await asRoleIn('app_auth', tenant.id, async (client) => {
      const id = await insertRow(client, 'auth.sso_domain', made);
      expect(
        await outcome(client, "UPDATE auth.sso_domain SET state = 'verified' WHERE id = $1", [id]),
      ).toBe('23514');
      expect(
        await outcome(client, 'UPDATE auth.sso_domain SET domain = domain WHERE id = $1', [id]),
      ).toBe('42501');
    });
  });
});

describe('SSO identities in auth.account', { timeout: 30_000 }, () => {
  it('takes tenant, provider and issuer from the provider, whatever the insert says', async () => {
    const { tenant, made } = await fixture(addProvider);
    const other = await withClient('migrator', addTestTenant);
    await asRoleIn('app_auth', tenant.id, async (client) => {
      const userId = await addUser(client);
      const insert = (extra: string, values: unknown[]) =>
        outcome(
          client,
          `INSERT INTO auth.account (user_id, account_id, provider_id${extra}) VALUES ($1, 'subject', $2${values.length > 0 ? ', $3' : ''})`,
          [userId, made.id, ...values],
        );
      expect(await insert(', tenant_id', [other.id]), 'naming a tenant').toBe('42501');
      expect(await insert('', []), 'naming only the provider').toBe('ok');
      await client.query(
        `INSERT INTO auth.account (user_id, account_id, provider_id) VALUES ($1, 'subject', $2)`,
        [userId, made.id],
      );
      const { rows } = await client.query<{
        tenant_id: string;
        sso_provider_id: string;
        sso_issuer: string;
      }>('SELECT tenant_id, sso_provider_id, sso_issuer FROM auth.account WHERE user_id = $1', [
        userId,
      ]);
      expect(rows).toEqual([
        { tenant_id: tenant.id, sso_provider_id: made.id, sso_issuer: made.issuer },
      ]);
      for (const set of ['tenant_id = NULL', 'sso_provider_id = NULL', 'sso_issuer = NULL']) {
        expect(
          await outcome(client, `UPDATE auth.account SET ${set} WHERE user_id = $1`, [userId]),
          set,
        ).toBe('42501');
      }
      expect(
        await outcome(
          client,
          `INSERT INTO auth.account (user_id, account_id, provider_id) VALUES ($1, 'subject', $2)`,
          [await addUser(client), made.id],
        ),
        'the same subject from the same provider',
      ).toBe('23505');
    });
  });

  it('refuses an identity for an unknown provider, or with no tenant set', async () => {
    const { tenant, made } = await fixture(addProvider);
    const insert = `INSERT INTO auth.account (user_id, account_id, provider_id) VALUES ($1, 'subject', $2)`;
    await asRoleIn('app_auth', tenant.id, async (client) => {
      const userId = await addUser(client);
      expect(await outcome(client, insert, [userId, 'google'])).toBe('23514');
    });
    await withClient('app_auth', async (client) => {
      await client.query('BEGIN');
      try {
        expect(await outcome(client, insert, [await addUser(client), made.id])).toBe('23514');
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('keeps credential accounts free of any tenant, with a password', async () => {
    const { tenant } = await fixture(addProvider);
    await asRoleIn('app_auth', tenant.id, async (client) => {
      const userId = await addUser(client);
      const insert = `INSERT INTO auth.account (user_id, account_id, provider_id, password) VALUES ($1::uuid, $1::uuid::text, 'credential', $2::text)`;
      expect(await outcome(client, insert, [userId, null]), 'no password').toBe('23514');
      const hash = `$argon2id$v=19$m=19456,t=2,p=1$${'a'.repeat(22)}$${'b'.repeat(43)}`;
      await client.query(insert, [userId, hash]);
      const { rows } = await client.query(
        'SELECT tenant_id, sso_provider_id, sso_issuer FROM auth.account WHERE user_id = $1',
        [userId],
      );
      expect(rows).toEqual([{ tenant_id: null, sso_provider_id: null, sso_issuer: null }]);
    });
  });
});
