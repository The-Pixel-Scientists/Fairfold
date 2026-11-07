// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0025's down.sql refuses, changing nothing, while an auth event
// records a backup code used or made: auth events are append-only (rule 4).
// Otherwise it clears stored backup codes, which nothing before 0025 may
// hold. Each case runs in a transaction that is always rolled back.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorRolledBack } from '../connect.ts';
import { addUser } from './fixtures.ts';

const down = () => readFile(join(MIGRATIONS_FOLDER, '0025_auth_backup_codes', 'down.sql'), 'utf8');

const codesCheck = `SELECT pg_catalog.pg_get_constraintdef(oid) AS definition
                      FROM pg_catalog.pg_constraint
                     WHERE conrelid = 'auth.two_factor'::regclass
                       AND conname = 'two_factor_backup_codes_check'`;

describe('migration 0025 down', { timeout: 30_000 }, () => {
  it.each(['backup_code_used', 'backup_codes_regenerated'])(
    'refuses while a %s event exists',
    async (code) => {
      const sql = await down();
      await asMigratorRolledBack(async (client) => {
        await client.query('INSERT INTO auth.audit_event (request_id, code) VALUES ($1, $2)', [
          randomUUID(),
          code,
        ]);
        await client.query('SAVEPOINT down');
        await expect(client.query(sql)).rejects.toThrow(
          'Migration 0025 cannot be rolled back: auth events with backup_code_used or backup_codes_regenerated exist.',
        );
        await client.query('ROLLBACK TO SAVEPOINT down');
        const check = await client.query<{ definition: string }>(codesCheck);
        expect(check.rows[0]?.definition).toContain('verified');
      });
    },
  );

  it('clears stored backup codes and lets no role write them again', async () => {
    const sql = await down();
    await asMigratorRolledBack(async (client) => {
      // As a fresh database starts; only the owner may truncate, and it is rolled back.
      await client.query('TRUNCATE auth.audit_copy_pending, auth.audit_event');
      const userId = await addUser(client);
      await client.query(
        `INSERT INTO auth.two_factor (user_id, secret, verified, backup_codes)
         VALUES ($1, $2, true, $3)`,
        [userId, 'a1'.repeat(60), `1:${'c3'.repeat(32)}`],
      );
      await client.query(sql);
      const { rows } = await client.query(
        'SELECT backup_codes FROM auth.two_factor WHERE user_id = $1',
        [userId],
      );
      expect(rows).toEqual([{ backup_codes: null }]);
      const check = await client.query<{ definition: string }>(codesCheck);
      expect(check.rows[0]?.definition).toBe('CHECK ((backup_codes IS NULL))');
    });
  });
});
