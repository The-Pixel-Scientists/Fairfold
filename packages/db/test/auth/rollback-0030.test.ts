// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0030's down.sql drops auth.passkey and its grants, which up.sql
// restores exactly, and refuses, changing nothing, while an auth event
// records a passkey change: auth events are append-only (rule 4), so it
// never deletes them. Each case runs in a transaction that is always rolled
// back.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorRolledBack } from '../connect.ts';

const read = (file: string) => readFile(join(MIGRATIONS_FOLDER, '0030_auth_passkey', file), 'utf8');

/**
 * The passkey table's columns, grants, checks and policies. Not the event
 * check, which later migrations widen; migrations.test.ts checks it round
 * trip by round trip.
 */
async function state(client: pg.Client): Promise<unknown[]> {
  const { rows } = await client.query<{ name: string; value: string | null }>(
    `SELECT a.attname AS name, a.atttypid::regtype::text || ' ' || coalesce(a.attacl::text, '')
              AS value
       FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = to_regclass('auth.passkey') AND a.attnum > 0
     UNION ALL
     SELECT 'table', c.relacl::text || ' ' || c.relrowsecurity || ' ' || c.relforcerowsecurity
       FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('auth.passkey')
     UNION ALL
     SELECT polname, pg_catalog.pg_get_expr(polqual, polrelid) FROM pg_catalog.pg_policy
      WHERE polrelid = to_regclass('auth.passkey')
     UNION ALL
     SELECT conname, pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('auth.passkey')
     ORDER BY 1, 2`,
  );
  return rows;
}

describe('migration 0030 down', { timeout: 30_000 }, () => {
  it('drops auth.passkey, and is undone exactly by up.sql', async () => {
    const [downSql, upSql] = await Promise.all([read('down.sql'), read('up.sql')]);
    await asMigratorRolledBack(async (client) => {
      // As a fresh database has none; the API's tests leave events behind.
      await client.query('TRUNCATE auth.audit_copy_pending, auth.audit_event');
      const before = await state(client);
      await client.query(downSql);
      const { rows } = await client.query<{ found: string | null }>(
        `SELECT to_regclass('auth.passkey')::text AS found`,
      );
      expect(rows).toEqual([{ found: null }]);
      expect(await state(client)).not.toEqual(before);
      await client.query(upSql);
      expect(await state(client)).toEqual(before);
    });
  });

  it.each(['passkey_added', 'passkey_removed'])('refuses while a %s event exists', async (code) => {
    const sql = await read('down.sql');
    await asMigratorRolledBack(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO auth.audit_event (request_id, code) VALUES ($1, $2) RETURNING id',
        [randomUUID(), code],
      );
      await client.query('SAVEPOINT down');
      await expect(client.query(sql)).rejects.toThrow(
        'Migration 0030 cannot be rolled back: auth events with passkey_added or passkey_removed exist.',
      );
      await client.query('ROLLBACK TO SAVEPOINT down');

      const kept = await client.query('SELECT 1 FROM auth.audit_event WHERE id = $1', [
        rows[0]?.id,
      ]);
      expect(kept.rowCount).toBe(1);
      const table = await client.query(`SELECT to_regclass('auth.passkey') IS NOT NULL AS found`);
      expect(table.rows).toEqual([{ found: true }]);
    });
  });
});
