// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0050's indexes and generated columns, and that pg_trgm is reached
// only as ADR 0025 allows: through schema ext, which only app_api and
// app_worker use.

import { describe, expect, it } from 'vitest';

import { RIGHTS_ROLES, withClient, withRoleClient } from '../connect.ts';
import { outcome } from '../tenants.ts';

/** The SQLSTATE of each statement run as `role`, inside a transaction that is undone. */
function outcomesAs(role: 'app_api' | 'app_worker' | 'app_auth' | 'app_queue') {
  return withRoleClient(role, async (client) => {
    await client.query('BEGIN');
    try {
      return [
        await outcome(client, `SELECT ext.similarity('a', 'b')`),
        await outcome(client, `SELECT 'a' OPERATOR(ext.%) 'b'`),
      ];
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

const INDEXES = [
  ['organisation_name_trgm', 'party.organisation', 'gin (name ext.gin_trgm_ops)'],
  [
    'organisation_identifier_identifier_trgm',
    'party.organisation_identifier',
    'gin (identifier ext.gin_trgm_ops)',
  ],
  ['person_given_name_trgm', 'party.person', 'gin (given_name ext.gin_trgm_ops)'],
  ['person_family_name_trgm', 'party.person', 'gin (family_name ext.gin_trgm_ops)'],
  ['person_email_trgm', 'party.person', 'gin (email ext.gin_trgm_ops)'],
  ['organisation_search_vector', 'party.organisation', 'gin (search_vector)'],
  ['person_search_vector', 'party.person', 'gin (search_vector)'],
] as const;

describe('migration 0050', () => {
  it.each(INDEXES)('builds %s on %s', async (name, table, method) => {
    await withClient('migrator', async (client) => {
      const { rows } = await client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
           FROM pg_catalog.pg_index i
          WHERE i.indexrelid = ('party.' || $1)::regclass`,
        [name],
      );
      expect(rows[0]?.definition).toBe(`CREATE INDEX ${name} ON ${table} USING ${method}`);
    });
  });

  it.each(['party.organisation', 'party.person'])(
    'generates %s.search_vector with the simple configuration, written by no app role',
    async (table) => {
      await withClient('migrator', async (client) => {
        const { rows } = await client.query<{ generated: string; expression: string }>(
          `SELECT a.attgenerated AS generated,
                  pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS expression
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = $1::regclass AND a.attname = 'search_vector'`,
          [table],
        );
        expect(rows[0]?.generated).toBe('s');
        expect(rows[0]?.expression).toContain(`'simple'::regconfig`);
        for (const role of RIGHTS_ROLES) {
          for (const right of ['INSERT', 'UPDATE']) {
            const { rows: can } = await client.query<{ has: boolean }>(
              `SELECT pg_catalog.has_column_privilege($1, $2::regclass, 'search_vector', $3) AS has`,
              [role, table, right],
            );
            expect(can[0]?.has, `${role} may ${right} ${table}.search_vector`).toBe(false);
          }
        }
      });
    },
  );

  it('keeps party.person.search_vector unreadable to app_worker, which runs subject access', async () => {
    await withClient('migrator', async (client) => {
      const { rows } = await client.query<{ has: boolean }>(
        `SELECT pg_catalog.has_column_privilege('app_worker', 'party.person',
                                                'search_vector', 'SELECT') AS has`,
      );
      expect(rows[0]?.has).toBe(false);
    });
  });
});

describe('schema ext', () => {
  it('gives PUBLIC no way to name a function in it', async () => {
    await withClient('migrator', async (client) => {
      const { rows } = await client.query<{ has: boolean }>(
        `SELECT pg_catalog.has_schema_privilege('public', 'ext', 'USAGE') AS has`,
      );
      expect(rows[0]?.has).toBe(false);
    });
  });

  it.each(['app_auth', 'app_queue'] as const)('refuses %s the functions by name', async (role) => {
    expect(await outcomesAs(role)).toEqual(['42501', '42501']);
  });

  it.each(['app_api', 'app_worker'] as const)(
    'lets %s use them, as ADR 0025 grants',
    async (role) => {
      expect(await outcomesAs(role)).toEqual(['ok', 'ok']);
    },
  );
});
