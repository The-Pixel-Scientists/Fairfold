// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Device cookies' rows and counters (migration 0022): only app_auth reaches
// them, a revoked device stays revoked, the database refuses to delete a
// device before its retention ends, and a device counter goes with its
// device. A device has no tenant (an account spans tenants), so the denial
// tests are by role rather than by tenant.

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { withClient } from '../connect.ts';
import { outcome } from '../tenants.ts';
import { addUser, asRoleRolledBack, tokenHash } from './fixtures.ts';

/** Add a device for a new account as app_auth, in the rolled-back transaction of `client`. */
async function addDevice(client: Parameters<typeof addUser>[0]) {
  const userId = await addUser(client);
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO auth.device (user_id, device_hash, key_version) VALUES ($1, $2, 1) RETURNING id',
    [userId, tokenHash()],
  );
  return { userId, id: rows[0]?.id ?? '' };
}

describe('auth.device', { timeout: 30_000 }, () => {
  it.each(['app_api', 'app_worker', 'app_queue'] as const)(
    'lets %s neither read nor write it',
    async (role) => {
      await asRoleRolledBack(role, async (client) => {
        const statements: [string, unknown[]][] = [
          ['SELECT 1 FROM auth.device', []],
          [
            'INSERT INTO auth.device (user_id, device_hash, key_version) VALUES ($1, $2, 1)',
            [randomUUID(), tokenHash()],
          ],
          ['UPDATE auth.device SET revoked_at = now()', []],
          ['DELETE FROM auth.device', []],
        ];
        for (const [statement, values] of statements) {
          expect(await outcome(client, statement, values), statement).toBe('42501');
        }
      });
    },
  );

  it.each([
    [
      'a hash that is not 32 bytes',
      `INSERT INTO auth.device (user_id, device_hash, key_version) VALUES ($1, '\\x00', 1)`,
      '23514',
    ],
    [
      'a key version below 1',
      'INSERT INTO auth.device (user_id, device_hash, key_version) VALUES ($1, $2, 0)',
      '23514',
    ],
    [
      'app_auth setting the issue time',
      `INSERT INTO auth.device (user_id, device_hash, key_version, issued_at) VALUES ($1, $2, 1, now() - interval '1 day')`,
      '42501',
    ],
    [
      'app_auth setting the id',
      'INSERT INTO auth.device (id, user_id, device_hash, key_version) VALUES (gen_random_uuid(), $1, $2, 1)',
      '42501',
    ],
    ['app_auth moving a device to another account', 'UPDATE auth.device SET user_id = $1', '42501'],
  ])('%s', async (_, statement, expected) => {
    const result = await asRoleRolledBack('app_auth', async (client) => {
      const { userId } = await addDevice(client);
      const values = statement.includes('$2') ? [userId, tokenHash()] : [userId];
      return outcome(client, statement, values);
    });
    expect(result).toBe(expected);
  });

  it('refuses a last use or revocation before issue', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      const { id } = await addDevice(client);
      // In one transaction now() is fixed, so an earlier time is before issue.
      for (const column of ['last_used_at', 'revoked_at']) {
        expect(
          await outcome(
            client,
            `UPDATE auth.device SET ${column} = now() - interval '1 second' WHERE id = $1`,
            [id],
          ),
        ).toBe('23514');
      }
    });
  });

  it('keeps a revoked device revoked, and app_auth may use and revoke a live one', async () => {
    await asRoleRolledBack('app_auth', async (client) => {
      const { id } = await addDevice(client);
      const update = async (set: string) =>
        (await client.query(`UPDATE auth.device SET ${set} WHERE id = $1`, [id])).rowCount;
      expect(await update('last_used_at = now()')).toBe(1);
      expect(await update('revoked_at = now()')).toBe(1);
      expect(await update('revoked_at = NULL')).toBe(0);
      expect(await update('last_used_at = now()')).toBe(0);
    });
  });

  it('lets app_auth delete a device only 12 months after issue or 30 days after revocation', async () => {
    const userId = await withClient('app_auth', (client) => addUser(client));
    // Expired, revoked 31 days ago, revoked 29 days ago, and live.
    await withClient('migrator', (client) =>
      client.query(
        `INSERT INTO auth.device (user_id, device_hash, key_version, issued_at, last_used_at,
                                  revoked_at)
         SELECT $1::uuid, sha256(convert_to(n || $1::uuid::text, 'UTF8')), 1, issued, issued, revoked
           FROM (VALUES
             (1, now() - interval '12 months 1 day', NULL::timestamptz),
             (2, now() - interval '2 months', now() - interval '31 days'),
             (3, now() - interval '2 months', now() - interval '29 days'),
             (4, now() - interval '11 months', NULL)) AS d(n, issued, revoked)`,
        [userId],
      ),
    );
    const deleted = await asRoleRolledBack(
      'app_auth',
      async (client) =>
        (await client.query('DELETE FROM auth.device WHERE user_id = $1', [userId])).rowCount,
    );
    expect(deleted).toBe(2);
  });

  it('goes with its account', async () => {
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
          WHERE conrelid = 'auth.device'::regclass AND contype = 'f'`,
      ),
    );
    expect(rows).toEqual([
      { definition: 'FOREIGN KEY (user_id) REFERENCES auth."user"(id) ON DELETE CASCADE' },
    ]);
  });
});

describe('a device counter in auth.rate_limit', { timeout: 30_000 }, () => {
  const insert = (scope: string, withDevice: boolean) =>
    asRoleRolledBack('app_auth', async (client) => {
      const { id } = await addDevice(client);
      return outcome(
        client,
        `INSERT INTO auth.rate_limit (scope, identifier, device_id) VALUES ($1, 'a@example.test', $2)`,
        [scope, withDevice ? id : null],
      );
    });

  it.each([
    ['sign_in_identifier_device', true, 'ok'],
    ['sign_in_identifier_device', false, '23514'],
    ['sign_in_identifier', true, '23514'],
    ['sign_in_identifier', false, 'ok'],
  ] as const)('%s with a device (%s) is %s', async (scope, withDevice, expected) => {
    expect(await insert(scope, withDevice)).toBe(expected);
  });

  it('goes when its device is deleted', async () => {
    const userId = await withClient('app_auth', (client) => addUser(client));
    const counted = await withClient('migrator', async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO auth.device (user_id, device_hash, key_version, issued_at, last_used_at)
         VALUES ($1, $2, 1, now() - interval '13 months', now() - interval '13 months')
         RETURNING id`,
        [userId, tokenHash()],
      );
      const id = rows[0]?.id ?? '';
      await client.query(
        `INSERT INTO auth.rate_limit (scope, identifier, device_id, count)
         VALUES ('sign_in_identifier_device', 'a@example.test', $1, 3)`,
        [id],
      );
      return id;
    });
    await withClient('app_auth', (client) =>
      client.query('DELETE FROM auth.device WHERE id = $1', [counted]),
    );
    const { rows } = await withClient('migrator', (client) =>
      client.query('SELECT 1 FROM auth.rate_limit WHERE device_id = $1', [counted]),
    );
    expect(rows).toEqual([]);
  });
});
