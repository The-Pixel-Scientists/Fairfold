// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Passkeys (migration 0030): only app_auth reaches them, and after the
// insert it may change only the counter, the time of last use and the name;
// the database checks every column's shape. A passkey has no tenant (an
// account spans tenants), so the denial tests are by role rather than by
// tenant; the API proves one user cannot reach another's passkey.

import { randomBytes, randomUUID } from 'node:crypto';

import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { APP_ROLES, withClient } from '../connect.ts';
import { outcome } from '../tenants.ts';
import { addUser, asRoleRolledBack } from './fixtures.ts';

const COLUMNS = 'user_id, credential_id, public_key, counter, name, device_type, backed_up';

const credentialId = () => randomBytes(32).toString('base64url');
const publicKey = randomBytes(77).toString('base64');

/** Add a passkey for a new account through `client`. */
async function addPasskey(client: pg.ClientBase) {
  const userId = await addUser(client);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO auth.passkey (${COLUMNS}, transports, aaguid)
     VALUES ($1, $2, $3, 0, 'Laptop', 'multiDevice', true, 'hybrid,internal', $4) RETURNING id`,
    [userId, credentialId(), publicKey, randomUUID()],
  );
  return { userId, id: rows[0]?.id ?? '' };
}

describe('auth.passkey', { timeout: 30_000 }, () => {
  it.each(['app_api', 'app_worker', 'app_queue'] as const)(
    'lets %s neither read nor write it',
    async (role) => {
      await asRoleRolledBack(role, async (client) => {
        const statements: [string, unknown[]][] = [
          ['SELECT 1 FROM auth.passkey', []],
          [
            `INSERT INTO auth.passkey (${COLUMNS}) VALUES ($1, $2, $3, 0, 'Key', 'singleDevice', false)`,
            [randomUUID(), credentialId(), publicKey],
          ],
          [`UPDATE auth.passkey SET name = 'Key'`, []],
          ['DELETE FROM auth.passkey', []],
        ];
        for (const [statement, values] of statements) {
          expect(await outcome(client, statement, values), statement).toBe('42501');
        }
      });
    },
  );

  it('lets app_auth update the counter, last use and name alone', async () => {
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ right: string }>(
        `SELECT r.name || ' ' || a.attname AS right
           FROM pg_catalog.pg_attribute a
          CROSS JOIN pg_catalog.unnest($1::text[]) AS r(name)
          WHERE a.attrelid = 'auth.passkey'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND pg_catalog.has_column_privilege(r.name, a.attrelid, a.attnum, 'UPDATE')
          ORDER BY 1`,
        [APP_ROLES],
      ),
    );
    expect(rows.map(({ right }) => right)).toEqual([
      'app_auth counter',
      'app_auth last_used_at',
      'app_auth name',
    ]);
  });

  it.each([
    ['a negative counter', 'counter = -1', '23514'],
    ['a counter past 32 bits', 'counter = 4294967296', '23514'],
    ['an empty name', `name = ''`, '23514'],
    ['a name of 65 characters', `name = repeat('a', 65)`, '23514'],
    ['a name with a control character', `name = E'Lap\\ntop'`, '23514'],
    ['a name of 64 characters', `name = repeat('a', 64)`, 'ok'],
    ['a last use before it was made', `last_used_at = now() - interval '1 second'`, '23514'],
    ['moving it to another account', 'user_id = gen_random_uuid()', '42501'],
    ['a new credential id', `credential_id = 'abc'`, '42501'],
    ['a new public key', `public_key = 'abc'`, '42501'],
  ])('refuses or allows %s', async (_, set, expected) => {
    const result = await asRoleRolledBack('app_auth', async (client) => {
      const { id } = await addPasskey(client);
      return outcome(client, `UPDATE auth.passkey SET ${set} WHERE id = $1`, [id]);
    });
    expect(result).toBe(expected);
  });

  it.each([
    [
      'a credential id that is not base64url',
      `'not base64url!'`,
      `'${publicKey}'`,
      `'multiDevice'`,
    ],
    ['a public key that is not base64', `'${credentialId()}'`, `'not base64!'`, `'multiDevice'`],
    ['an unknown device type', `'${credentialId()}'`, `'${publicKey}'`, `'oneDevice'`],
    [
      'a single-device passkey that is backed up',
      `'${credentialId()}'`,
      `'${publicKey}'`,
      `'singleDevice'`,
    ],
  ])('refuses %s', async (_, credential, key, deviceType) => {
    const result = await asRoleRolledBack('app_auth', async (client) => {
      const userId = await addUser(client);
      return outcome(
        client,
        `INSERT INTO auth.passkey (${COLUMNS})
         VALUES ($1, ${credential}, ${key}, 0, 'Key', ${deviceType}, true)`,
        [userId],
      );
    });
    expect(result).toBe('23514');
  });

  it.each([
    ['a bad transport list', 'transports', `'usb,,nfc'`],
    ['the id', 'id', 'gen_random_uuid()'],
    ['the creation time', 'created_at', 'now()'],
    ['the time of last use', 'last_used_at', 'now()'],
  ])('refuses an insert setting %s', async (_, column, value) => {
    const result = await asRoleRolledBack('app_auth', async (client) => {
      const userId = await addUser(client);
      return outcome(
        client,
        `INSERT INTO auth.passkey (${COLUMNS}, ${column})
         VALUES ($1, $2, $3, 0, 'Key', 'singleDevice', false, ${value})`,
        [userId, credentialId(), publicKey],
      );
    });
    expect(result).toBe(column === 'transports' ? '23514' : '42501');
  });

  it('holds each credential once, across accounts', async () => {
    const result = await asRoleRolledBack('app_auth', async (client) => {
      const { id } = await addPasskey(client);
      return outcome(
        client,
        `INSERT INTO auth.passkey (${COLUMNS})
         SELECT $1, credential_id, public_key, 0, 'Key', 'singleDevice', false
           FROM auth.passkey WHERE id = $2`,
        [await addUser(client), id],
      );
    });
    expect(result).toBe('23505');
  });

  it('lets app_auth delete a passkey, and goes with its account', async () => {
    const deleted = await asRoleRolledBack('app_auth', async (client) => {
      const { id } = await addPasskey(client);
      return (await client.query('DELETE FROM auth.passkey WHERE id = $1', [id])).rowCount;
    });
    expect(deleted).toBe(1);
    const { rows } = await withClient('app_auth', (client) =>
      client.query<{ definition: string }>(
        `SELECT pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint
          WHERE conrelid = 'auth.passkey'::regclass AND contype = 'f'`,
      ),
    );
    expect(rows).toEqual([
      { definition: 'FOREIGN KEY (user_id) REFERENCES auth."user"(id) ON DELETE CASCADE' },
    ]);
  });
});
