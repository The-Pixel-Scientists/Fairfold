// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0023's down.sql refuses, changing nothing, while an auth event
// records an authenticator removed or a password changed: auth events are
// append-only (rule 4), so it never deletes them. It runs in a transaction
// that is always rolled back.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';
import { asMigratorRolledBack } from '../connect.ts';

describe('migration 0023 down', { timeout: 30_000 }, () => {
  it.each(['mfa_removed', 'password_changed'])('refuses while a %s event exists', async (code) => {
    const down = await readFile(
      join(MIGRATIONS_FOLDER, '0023_auth_account_change_events', 'down.sql'),
      'utf8',
    );
    await asMigratorRolledBack(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO auth.audit_event (request_id, code) VALUES ($1, $2) RETURNING id',
        [randomUUID(), code],
      );
      await client.query('SAVEPOINT down');
      await expect(client.query(down)).rejects.toThrow(
        'Migration 0023 cannot be rolled back: auth events with mfa_removed or password_changed exist.',
      );
      await client.query('ROLLBACK TO SAVEPOINT down');

      const kept = await client.query('SELECT 1 FROM auth.audit_event WHERE id = $1', [
        rows[0]?.id,
      ]);
      expect(kept.rowCount).toBe(1);
      const check = await client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
          WHERE conrelid = 'auth.audit_event'::regclass AND conname = 'audit_event_code_check'`,
      );
      expect(check.rows[0]?.definition).toContain(code);
    });
  });
});
