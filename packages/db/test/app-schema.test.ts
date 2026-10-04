// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0001 against the test database: the app schema, its grants,
// app.current_tenant_id() and app.enable_tenant_rls().

import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { APP_ROLES, asMigratorRolledBack, withClient } from './connect.ts';

const tenantA = '1a2b3c4d-0000-4000-8000-00000000000a';
const tenantB = '1a2b3c4d-0000-4000-8000-00000000000b';

/** Owner and grants of an object, each grant as "grantee PRIVILEGE", sorted. */
async function ownerAndGrants(
  client: pg.ClientBase,
  catalogQuery: string,
  values: unknown[] = [],
): Promise<{ owner: string; grants: string[] }> {
  const { rows } = await client.query<{ owner: string; acl: string[] }>(catalogQuery, values);
  const [row] = rows;
  if (!row) throw new Error('The object does not exist.');
  return { owner: row.owner, grants: [...row.acl].sort() };
}

const SCHEMA_ACL = `
  SELECT n.nspowner::regrole::text AS owner,
         ARRAY(SELECT COALESCE(NULLIF(a.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || a.privilege_type
                 FROM pg_catalog.aclexplode(n.nspacl) a) AS acl
    FROM pg_catalog.pg_namespace n WHERE n.nspname = 'app'`;

/** $1 is the function's signature. */
const FUNCTION_ACL = `
  SELECT p.proowner::regrole::text AS owner,
         ARRAY(SELECT COALESCE(NULLIF(a.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || a.privilege_type
                 FROM pg_catalog.aclexplode(
                   COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a) AS acl
    FROM pg_catalog.pg_proc p WHERE p.oid = $1::regprocedure`;

async function sqlState(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error) {
    return (error as pg.DatabaseError).code;
  }
  return undefined;
}

describe('the app schema', () => {
  it('is owned by migrator, and the app roles and function owners may only use it', async () => {
    const acl = await withClient('app_api', (client) => ownerAndGrants(client, SCHEMA_ACL));
    expect(acl).toEqual({
      owner: 'migrator',
      grants: [
        ...APP_ROLES.map((role) => `${role} USAGE`),
        'migrator CREATE',
        'migrator USAGE',
        // The functions of migration 0006 read or write tables in app.
        'owner_app_create_tenant USAGE',
        'owner_app_public_tenant USAGE',
        'owner_app_public_tenant_logo USAGE',
        'owner_auth_session_memberships USAGE',
      ].sort(),
    });
  });
});

describe('app.current_tenant_id()', () => {
  it('is a stable, parallel-safe invoker function owned by migrator', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query(`
        SELECT p.provolatile AS volatility, p.proparallel AS parallel, p.prosecdef AS definer,
               p.prorettype::regtype::text AS returns, p.proconfig AS config
          FROM pg_catalog.pg_proc p WHERE p.oid = 'app.current_tenant_id()'::regprocedure`),
    );
    expect(rows).toEqual([
      { volatility: 's', parallel: 's', definer: false, returns: 'uuid', config: null },
    ]);
  });

  it('can be executed by the app roles and migrator only', async () => {
    const acl = await withClient('app_api', (client) =>
      ownerAndGrants(client, FUNCTION_ACL, ['app.current_tenant_id()']),
    );
    expect(acl).toEqual({
      owner: 'migrator',
      grants: [...APP_ROLES, 'migrator'].map((role) => `${role} EXECUTE`).sort(),
    });
  });

  it.each(APP_ROLES)(
    'returns the tenant of the transaction for %s, and NULL without one',
    async (role) => {
      await withClient(role, async (client) => {
        const read = async () =>
          (
            await client.query<{ tenant: string | null }>(
              'SELECT app.current_tenant_id() AS tenant',
            )
          ).rows[0]?.tenant;

        expect(await read()).toBeNull();

        await client.query('BEGIN');
        await client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenantA]);
        expect(await read()).toBe(tenantA);
        await client.query('COMMIT');

        // After the transaction the setting is an empty string, not NULL.
        expect(await read()).toBeNull();
      });
    },
  );

  it('fails the query when the setting is not a uuid', async () => {
    await withClient('app_api', async (client) => {
      await client.query('BEGIN');
      await client.query("SELECT pg_catalog.set_config('app.tenant_id', 'tenant-a', true)");
      expect(await sqlState(client.query('SELECT app.current_tenant_id()'))).toBe('22P02');
      await client.query('ROLLBACK');
    });
  });
});

describe('app.enable_tenant_rls()', () => {
  it('can be executed by migrator only', async () => {
    const acl = await withClient('app_api', (client) =>
      ownerAndGrants(client, FUNCTION_ACL, ['app.enable_tenant_rls(regclass)']),
    );
    expect(acl).toEqual({ owner: 'migrator', grants: ['migrator EXECUTE'] });

    for (const role of APP_ROLES) {
      const state = await withClient(role, (client) =>
        sqlState(client.query("SELECT app.enable_tenant_rls('pg_catalog.pg_class')")),
      );
      expect(state).toBe('42501');
    }
  });

  it('is an invoker function with a pinned search_path', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query(`
        SELECT p.prosecdef AS definer, p.proconfig AS config
          FROM pg_catalog.pg_proc p WHERE p.oid = 'app.enable_tenant_rls(regclass)'::regprocedure`),
    );
    expect(rows).toEqual([{ definer: false, config: ['search_path=pg_catalog, pg_temp'] }]);
  });

  it('enables and forces row-level security and adds one tenant policy per command', async () => {
    const { table, policies } = await asMigratorRolledBack(async (client) => {
      await client.query(`
        CREATE TABLE app.rls_check (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, note text);
        SELECT app.enable_tenant_rls('app.rls_check');`);
      const flags = await client.query(`
        SELECT relrowsecurity AS rls, relforcerowsecurity AS forced
          FROM pg_catalog.pg_class WHERE oid = 'app.rls_check'::regclass`);
      const added = await client.query(`
        SELECT policyname AS name, permissive, roles::text[] AS roles, cmd AS command,
               qual AS using, with_check
          FROM pg_catalog.pg_policies
         WHERE schemaname = 'app' AND tablename = 'rls_check'
         ORDER BY policyname`);
      return { table: flags.rows, policies: added.rows };
    });

    const tenantTerm = '(tenant_id = app.current_tenant_id())';
    const policy = (
      name: string,
      command: string,
      using: string | null,
      withCheck: string | null,
    ) => ({
      name,
      permissive: 'PERMISSIVE',
      roles: ['public'],
      command,
      using,
      with_check: withCheck,
    });
    expect(table).toEqual([{ rls: true, forced: true }]);
    expect(policies).toEqual([
      policy('tenant_delete', 'DELETE', tenantTerm, null),
      policy('tenant_insert', 'INSERT', null, tenantTerm),
      policy('tenant_select', 'SELECT', tenantTerm, null),
      policy('tenant_update', 'UPDATE', tenantTerm, tenantTerm),
    ]);
  });

  it("keeps one tenant's rows from another, even for the table's owner", async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query(`
        CREATE TABLE app.rls_check (id integer PRIMARY KEY, tenant_id uuid NOT NULL, note text);
        SELECT app.enable_tenant_rls('app.rls_check');`);

      const setTenant = (tenant: string) =>
        client.query("SELECT pg_catalog.set_config('app.tenant_id', $1, true)", [tenant]);
      const visible = async () =>
        (
          await client.query<{ id: number; tenant_id: string; note: string }>(
            'SELECT id, tenant_id, note FROM app.rls_check ORDER BY id',
          )
        ).rows;
      // Run a statement that should fail, and undo it so the test can go on.
      const refused = async (text: string, values: unknown[] = []) => {
        await client.query('SAVEPOINT attempt');
        const state = await sqlState(client.query(text, values));
        await client.query('ROLLBACK TO SAVEPOINT attempt');
        return state;
      };

      await setTenant(tenantA);
      await client.query("INSERT INTO app.rls_check VALUES (1, $1, 'a')", [tenantA]);
      await setTenant(tenantB);
      await client.query("INSERT INTO app.rls_check VALUES (2, $1, 'b')", [tenantB]);

      // As tenant B: only B's row, and A's cannot be changed, removed or written.
      expect(await visible()).toEqual([{ id: 2, tenant_id: tenantB, note: 'b' }]);
      const update = await client.query("UPDATE app.rls_check SET note = 'x' WHERE id = 1");
      expect(update.rowCount).toBe(0);
      const remove = await client.query('DELETE FROM app.rls_check WHERE id = 1');
      expect(remove.rowCount).toBe(0);
      expect(await refused("INSERT INTO app.rls_check VALUES (3, $1, 'a')", [tenantA])).toBe(
        '42501',
      );
      expect(await refused('UPDATE app.rls_check SET tenant_id = $1 WHERE id = 2', [tenantA])).toBe(
        '42501',
      );

      // With no tenant: no rows, and nothing can be written.
      await setTenant('');
      expect(await visible()).toEqual([]);
      expect(await refused("INSERT INTO app.rls_check VALUES (4, $1, 'a')", [tenantA])).toBe(
        '42501',
      );

      // A's row is untouched.
      await setTenant(tenantA);
      expect(await visible()).toEqual([{ id: 1, tenant_id: tenantA, note: 'a' }]);
    });
  });

  it.each([
    ['has no tenant_id', 'CREATE TABLE app.rls_check (id uuid PRIMARY KEY)'],
    ['allows a null tenant_id', 'CREATE TABLE app.rls_check (id uuid PRIMARY KEY, tenant_id uuid)'],
    [
      'has a text tenant_id',
      'CREATE TABLE app.rls_check (id uuid PRIMARY KEY, tenant_id text NOT NULL)',
    ],
    ['is a view', 'CREATE VIEW app.rls_check AS SELECT gen_random_uuid() AS tenant_id'],
  ])('refuses a table that %s', async (_, create) => {
    await asMigratorRolledBack(async (client) => {
      await client.query(create);
      await expect(client.query("SELECT app.enable_tenant_rls('app.rls_check')")).rejects.toThrow(
        'Table app.rls_check needs a tenant_id uuid NOT NULL column before tenant row-level security can be enabled.',
      );
    });
  });

  it('refuses a partitioned table, whose partitions would need policies of their own', async () => {
    await asMigratorRolledBack(async (client) => {
      await client.query(`
        CREATE TABLE app.rls_check (id uuid NOT NULL, tenant_id uuid NOT NULL)
          PARTITION BY HASH (tenant_id)`);
      await expect(client.query("SELECT app.enable_tenant_rls('app.rls_check')")).rejects.toThrow(
        'Table app.rls_check is partitioned, and app.enable_tenant_rls() does not handle partitioned tables yet: each partition would need its own policies.',
      );
    });
  });
});
