// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0028's down.sql takes back app_auth's update of an account's
// email, which up.sql restores exactly, and refuses, changing nothing, while
// an auth event records an email change: auth events are append-only (rule
// 4), so it never deletes them. Each case runs in a transaction that is
// always rolled back.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorRolledBack } from '../connect.ts';

const read = (file: string) =>
  readFile(join(MIGRATIONS_FOLDER, '0028_auth_email_change', file), 'utf8');
const down = () => read('down.sql');

/**
 * The grants on auth.user's columns, as the catalogue prints them. Not the
 * event check, which later migrations widen; migrations.test.ts checks it
 * round trip by round trip.
 */
async function state(client: pg.Client): Promise<unknown[]> {
  const { rows } = await client.query<{ name: string; value: string | null }>(
    `SELECT a.attname AS name, a.attacl::text AS value FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'auth."user"'::regclass AND a.attnum > 0
     ORDER BY 1`,
  );
  return rows;
}

async function mayUpdateEmail(client: pg.Client): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `SELECT pg_catalog.has_column_privilege('app_auth', 'auth."user"', 'email', 'UPDATE') AS may`,
  );
  return rows[0]?.may ?? false;
}

describe('migration 0028 down', { timeout: 30_000 }, () => {
  it('takes back the update of email', async () => {
    const sql = await down();
    await asMigratorRolledBack(async (client) => {
      expect(await mayUpdateEmail(client)).toBe(true);
      // As a fresh database has none; the API's tests leave events behind.
      await client.query('TRUNCATE auth.audit_copy_pending, auth.audit_event');
      await client.query(sql);
      expect(await mayUpdateEmail(client)).toBe(false);
    });
  });

  it('is undone exactly by up.sql', async () => {
    const [downSql, upSql] = await Promise.all([down(), read('up.sql')]);
    await asMigratorRolledBack(async (client) => {
      await client.query('TRUNCATE auth.audit_copy_pending, auth.audit_event');
      const before = await state(client);
      await client.query(downSql);
      expect(await state(client)).not.toEqual(before);
      await client.query(upSql);
      expect(await state(client)).toEqual(before);
    });
  });

  it('refuses while an email_changed event exists', async () => {
    const sql = await down();
    await asMigratorRolledBack(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO auth.audit_event (request_id, code) VALUES ($1, $2) RETURNING id',
        [randomUUID(), 'email_changed'],
      );
      await client.query('SAVEPOINT down');
      await expect(client.query(sql)).rejects.toThrow(
        'Migration 0028 cannot be rolled back: auth events with email_changed exist.',
      );
      await client.query('ROLLBACK TO SAVEPOINT down');

      const kept = await client.query('SELECT 1 FROM auth.audit_event WHERE id = $1', [
        rows[0]?.id,
      ]);
      expect(kept.rowCount).toBe(1);
      expect(await mayUpdateEmail(client)).toBe(true);
    });
  });
});
