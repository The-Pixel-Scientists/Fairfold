// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0002's helpers, app.deny_command() and app.set_updated_at(),
// and the test fixtures' refusal to write outside a test database.

import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { APP_ROLES, asMigratorRolledBack, withClient } from '../connect.ts';
import { committedIn, outcome } from '../tenants.ts';

describe('app.deny_command() and app.set_updated_at()', () => {
  it('are invoker functions with a pinned search_path that only migrator can run', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query(`
        SELECT p.oid::regprocedure::text AS name, p.prosecdef AS definer, p.proconfig AS config,
               ARRAY(SELECT a.grantee::regrole::text || ' ' || a.privilege_type
                       FROM pg_catalog.aclexplode(p.proacl) a) AS acl
          FROM pg_catalog.pg_proc p
         WHERE p.oid IN ('app.deny_command(regclass, text)'::regprocedure,
                         'app.set_updated_at()'::regprocedure)
         ORDER BY 1`),
    );
    const helper = (name: string) => ({
      name,
      definer: false,
      config: ['search_path=pg_catalog, pg_temp'],
      acl: ['migrator EXECUTE'],
    });
    expect(rows).toEqual([
      helper('app.deny_command(regclass,text)'),
      helper('app.set_updated_at()'),
    ]);

    for (const role of APP_ROLES) {
      const state = await withClient(role, async (client) => {
        await client.query('BEGIN');
        try {
          return await outcome(client, "SELECT app.deny_command('app.tenant', 'SELECT')");
        } finally {
          await client.query('ROLLBACK');
        }
      });
      expect(state, role).toBe('42501');
    }
  });

  it('deny_command() adds a restrictive false policy for one command, to every app role', async () => {
    const policies = await asMigratorRolledBack(async (client) => {
      await client.query(`
        CREATE TABLE app.deny_check (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
        SELECT app.deny_command('app.deny_check', 'INSERT');
        SELECT app.deny_command('app.deny_check', 'UPDATE');`);
      const { rows } = await client.query<Record<string, unknown>>(`
        SELECT policyname AS name, permissive, cmd AS command,
               ARRAY(SELECT r FROM pg_catalog.unnest(roles) AS r ORDER BY 1)::text[] AS roles,
               qual AS using, with_check
          FROM pg_catalog.pg_policies
         WHERE schemaname = 'app' AND tablename = 'deny_check'
         ORDER BY 1`);
      return rows;
    });
    const roles = [...APP_ROLES].sort();
    expect(policies).toEqual([
      {
        name: 'deny_insert',
        permissive: 'RESTRICTIVE',
        command: 'INSERT',
        roles,
        using: null,
        with_check: 'false',
      },
      {
        name: 'deny_update',
        permissive: 'RESTRICTIVE',
        command: 'UPDATE',
        roles,
        using: 'false',
        with_check: null,
      },
    ]);
  });

  it.each([
    [
      'TRUNCATE',
      "'app.tenant', 'TRUNCATE'",
      'Command TRUNCATE is not SELECT, INSERT, UPDATE or DELETE.',
    ],
    [
      'a command in lower case',
      "'app.tenant', 'select'",
      'Command select is not SELECT, INSERT, UPDATE or DELETE.',
    ],
    ['no command', "'app.tenant', NULL", 'Command <NULL> is not SELECT, INSERT, UPDATE or DELETE.'],
    ['a view', "'pg_catalog.pg_tables', 'SELECT'", 'pg_tables is not an ordinary table.'],
  ])('deny_command() refuses %s', async (_, args, message) => {
    await asMigratorRolledBack(async (client) => {
      await expect(client.query(`SELECT app.deny_command(${args})`)).rejects.toThrow(message);
    });
  });
});

describe('test fixtures', () => {
  it('refuse to write to a database whose name does not end in _test', async () => {
    const sent: string[] = [];
    const client = {
      query: (text: string) => {
        sent.push(text);
        return Promise.resolve({ rows: [{ database: 'tps_lane_db' }] });
      },
    } as unknown as pg.ClientBase;
    await expect(committedIn(client, randomUUID(), () => Promise.resolve())).rejects.toThrow(
      'Test fixtures go only in a database whose name ends in _test, not tps_lane_db.',
    );
    expect(sent).toEqual(['SELECT pg_catalog.current_database() AS database']);
  });
});
