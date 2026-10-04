// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who may reach the auth schema (migration 0004, ADR 0003, ADR 0010): only
// app_auth holds rights on its tables, never on the columns the database
// sets; nothing may write backup codes; each membership belongs to an
// account; and the checks copy the domain package's lists.

import { authEventCodes, mfaStates } from '@pixel-scientists/domain/auth';
import { apps } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { APP_ROLES, withClient } from '../connect.ts';
import { outcome } from '../tenants.ts';
import { AUTH_TABLES, asRoleRolledBack } from './fixtures.ts';

describe('the auth schema', { timeout: 30_000 }, () => {
  it.each(['app_api', 'app_worker', 'app_queue'] as const)(
    'lets %s select from no auth table',
    async (role) => {
      await asRoleRolledBack(role, async (client) => {
        for (const table of AUTH_TABLES) {
          const quoted = table.replace('.user', '."user"');
          expect(await outcome(client, `SELECT 1 FROM ${quoted}`), table).toBe('42501');
        }
      });
    },
  );

  it('grants rights on its tables to app_auth alone, and none on id, created_at or updated_at', async () => {
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ right: string }>(
        `SELECT r.name || ' ' || p.privilege || ' ' || a.attrelid::regclass || '.' || a.attname
                  AS right
           FROM pg_catalog.pg_attribute a
          CROSS JOIN pg_catalog.unnest($1::text[]) AS r(name)
          CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) AS p(privilege)
          WHERE a.attrelid = ANY ($2::regclass[]) AND a.attnum > 0 AND NOT a.attisdropped
            AND pg_catalog.has_column_privilege(r.name, a.attrelid, a.attnum, p.privilege)
            AND (r.name <> 'app_auth'
                 OR (p.privilege <> 'SELECT' AND a.attname IN ('id', 'created_at', 'updated_at')))
          ORDER BY 1`,
        [APP_ROLES, AUTH_TABLES],
      ),
    );
    expect(rows).toEqual([]);

    const deleters = await withClient('app_auth', (client) =>
      client.query<{ right: string }>(
        `SELECT r.name || ' ' || t.name AS right
           FROM pg_catalog.unnest($1::text[]) AS r(name)
          CROSS JOIN pg_catalog.unnest($2::text[]) AS t(name)
          WHERE r.name <> 'app_auth'
            AND pg_catalog.has_table_privilege(r.name, t.name::regclass, 'DELETE')`,
        [APP_ROLES, AUTH_TABLES],
      ),
    );
    expect(deleters.rows).toEqual([]);
  });

  it('lets no role write backup codes or a lockout, and keeps those columns empty', async () => {
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ right: string }>(
        `SELECT r.name || ' ' || c.name AS right
           FROM pg_catalog.unnest($1::text[]) AS r(name)
          CROSS JOIN pg_catalog.unnest($2::text[]) AS c(name)
          WHERE pg_catalog.has_column_privilege(r.name, 'auth.two_factor', c.name,
                                                'INSERT, UPDATE')`,
        [APP_ROLES, ['backup_codes', 'failed_verification_count', 'locked_until']],
      ),
    );
    expect(rows).toEqual([]);
    expect(
      await Promise.all(
        [
          'two_factor_backup_codes_check',
          'two_factor_failed_verification_count_check',
          'two_factor_locked_until_check',
        ].map(checkDefinition),
      ),
    ).toEqual([
      'CHECK ((backup_codes IS NULL))',
      'CHECK ((failed_verification_count = 0))',
      'CHECK ((locked_until IS NULL))',
    ]);
  });

  it('ties every membership to an account, which cannot be deleted while it has one', async () => {
    const { rows } = await withClient('app_api', (client) =>
      client.query(
        `SELECT o.confrelid::regclass::text AS referenced, o.confdeltype AS on_delete,
                pg_catalog.pg_get_constraintdef(o.oid) AS definition
           FROM pg_catalog.pg_constraint o
          WHERE o.conrelid = 'app.membership'::regclass AND o.conname = 'membership_user_id_fkey'`,
      ),
    );
    expect(rows).toEqual([
      {
        referenced: 'auth."user"',
        on_delete: 'r',
        definition: 'FOREIGN KEY (user_id) REFERENCES auth."user"(id) ON DELETE RESTRICT',
      },
    ]);
  });

  it.each([
    ['auth event codes', 'audit_event_code_check', authEventCodes],
    ['MFA states', 'session_mfa_state_check', mfaStates],
    ['apps', 'session_app_check', apps],
  ])('allows exactly the %s in the domain package', async (_, check, expected) => {
    const definition = await checkDefinition(check);
    const literals = [...definition.matchAll(/'([^']*)'::text/g)].map((match) => match[1]);
    expect(literals.sort()).toEqual([...expected].sort());
  });
});

/** A check in the auth schema, as pg_get_constraintdef prints it. */
async function checkDefinition(name: string): Promise<string> {
  const { rows } = await withClient('app_auth', (client) =>
    client.query<{ definition: string }>(
      `SELECT pg_catalog.pg_get_constraintdef(o.oid) AS definition
         FROM pg_catalog.pg_constraint o
        WHERE o.connamespace = 'auth'::regnamespace AND o.conname = $1`,
      [name],
    ),
  );
  const [row] = rows;
  if (!row) throw new Error(`There is no check named ${name}.`);
  return row.definition;
}
