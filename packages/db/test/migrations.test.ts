// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every migration's down.sql undoes exactly what its up.sql does. As
// migrator, inside one transaction that is rolled back at the end, this
// takes a snapshot of the schema, runs every down from the newest, then
// every up from the oldest, and checks the schema after each up matches the
// snapshot taken before the matching down.

import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER, SqlFolderMigrationProvider } from '../scripts/migrations.ts';
import { connectionSettings } from './connect.ts';

/**
 * One line for each object in every schema but PostgreSQL's own: schemas,
 * relations, columns, constraints, indexes, policies, triggers, functions,
 * types and default privileges, with owners and grants.
 */
async function snapshot(trx: Kysely<unknown>): Promise<string[]> {
  const { rows } = await sql<{ line: string }>`
    WITH s AS (
      SELECT oid, nspname FROM pg_catalog.pg_namespace
       WHERE NOT pg_catalog.starts_with(nspname, 'pg_') AND nspname <> 'information_schema'
    )
    SELECT line FROM (
      SELECT 'schema ' || nspname || ' ' || nspowner::regrole || ' ' || COALESCE(nspacl::text, '')
        FROM pg_catalog.pg_namespace WHERE oid IN (SELECT oid FROM s)
      UNION ALL
      SELECT 'relation ' || s.nspname || '.' || c.relname || ' ' || c.relkind::text || ' '
             || c.relowner::regrole || ' ' || COALESCE(c.relacl::text, '') || ' rls '
             || c.relrowsecurity || ' ' || c.relforcerowsecurity || ' '
             || COALESCE(c.reloptions::text, '')
        FROM pg_catalog.pg_class c JOIN s ON s.oid = c.relnamespace
      UNION ALL
      SELECT 'column ' || a.attrelid::regclass || '.' || a.attname || ' '
             || pg_catalog.format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' '
             || COALESCE(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '') || ' '
             || COALESCE(a.attacl::text, '')
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN s ON s.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'constraint ' || s.nspname || '.' || o.conname || ' on ' || o.conrelid::regclass
             || ' ' || pg_catalog.pg_get_constraintdef(o.oid)
        FROM pg_catalog.pg_constraint o JOIN s ON s.oid = o.connamespace
      UNION ALL
      SELECT 'index ' || pg_catalog.pg_get_indexdef(i.indexrelid)
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid JOIN s ON s.oid = c.relnamespace
      UNION ALL
      SELECT 'policy ' || p.polrelid::regclass || ' ' || p.polname || ' ' || p.polcmd::text || ' '
             || p.polpermissive || ' ' || p.polroles::regrole[]::text || ' '
             || COALESCE(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') || ' '
             || COALESCE(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')
        FROM pg_catalog.pg_policy p
        JOIN pg_catalog.pg_class c ON c.oid = p.polrelid JOIN s ON s.oid = c.relnamespace
      UNION ALL
      SELECT 'trigger ' || pg_catalog.pg_get_triggerdef(t.oid)
        FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN s ON s.oid = c.relnamespace
       WHERE NOT t.tgisinternal
      UNION ALL
      SELECT 'function ' || p.oid::regprocedure || ' ' || p.proowner::regrole || ' '
             || COALESCE(p.proacl::text, '') || ' '
             || CASE WHEN p.prokind IN ('f', 'p') THEN pg_catalog.pg_get_functiondef(p.oid)
                     ELSE p.prokind::text END
        FROM pg_catalog.pg_proc p JOIN s ON s.oid = p.pronamespace
      UNION ALL
      SELECT 'type ' || t.oid::regtype || ' ' || t.typtype::text || ' ' || t.typowner::regrole || ' '
             || COALESCE(t.typacl::text, '') || ' '
             || COALESCE((SELECT pg_catalog.string_agg(e.enumlabel::text, ',' ORDER BY e.enumsortorder)
                            FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid), '')
        FROM pg_catalog.pg_type t JOIN s ON s.oid = t.typnamespace
      UNION ALL
      SELECT 'default privileges ' || d.defaclrole::regrole || ' '
             || COALESCE(d.defaclnamespace::regnamespace::text, '') || ' '
             || d.defaclobjtype::text || ' ' || d.defaclacl::text
        FROM pg_catalog.pg_default_acl d
    ) objects (line)
    ORDER BY line COLLATE "C"
  `.execute(trx);
  return rows.map((row) => row.line);
}

describe('migrations', () => {
  it('each down.sql restores exactly the schema from before its up.sql', async () => {
    const provider = new SqlFolderMigrationProvider(MIGRATIONS_FOLDER);
    const found = await provider.getMigrations();
    const migrations = Object.keys(found)
      .sort()
      .map((name) => ({ name, ...found[name] }));
    expect(migrations.length).toBeGreaterThan(0);

    const db = new Kysely<unknown>({
      dialect: new PostgresDialect({
        pool: new pg.Pool({ ...connectionSettings('migrator'), max: 1 }),
      }),
    });
    const trx = await db.startTransaction().execute();
    try {
      // After the loop, before[i] is the schema with the first i migrations applied.
      const before = [await snapshot(trx)];
      for (const { name, down } of [...migrations].reverse()) {
        if (!down) throw new Error(`Migration ${name} has no down.`);
        await down(trx);
        before.unshift(await snapshot(trx));
      }

      // With every migration rolled back, no schema is left but PostgreSQL's
      // own, its public schema and the migration history.
      const { rows } = await sql<{ name: string }>`
        SELECT nspname AS name FROM pg_catalog.pg_namespace
         WHERE NOT pg_catalog.starts_with(nspname, 'pg_') AND nspname <> 'information_schema'
         ORDER BY 1`.execute(trx);
      expect(rows.map((row) => row.name)).toEqual(['migrations', 'public']);

      for (const [index, { name, up }] of migrations.entries()) {
        if (!up) throw new Error(`Migration ${name} has no up.`);
        await up(trx);
        expect(await snapshot(trx), `schema after ${name}`).toEqual(before[index + 1]);
      }
    } finally {
      await trx.rollback().execute();
      await db.destroy();
    }
  });
});
