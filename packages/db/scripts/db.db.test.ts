// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The database scripts' TLS rule against the development server, which offers
// no TLS. Preparing connects as the superuser, so these run in the db-admin
// Vitest project (`pnpm test:db`).

import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrateDatabase, prepareDatabase } from './db.ts';
import { LOGIN_ROLES, passwordVariable } from './roles.ts';
import { readDatabaseName } from './settings.ts';

const database = readDatabaseName(process.env, 'TPS_TEST_DB_NAME');

// A .invalid name never resolves (RFC 6761), so a network error would show
// that a connection was attempted before the setting was checked. The
// development passwords work only on this machine, so it gets its own.
const REMOTE = {
  TPS_DB_HOST: 'db.invalid',
  TPS_DB_TLS: undefined,
  ...Object.fromEntries(
    LOGIN_ROLES.map((role) => [passwordVariable(role), randomBytes(24).toString('base64url')]),
  ),
};
const NO_TLS_SETTING = 'Set TPS_DB_TLS for the database server at db.invalid';
const NO_TLS_SERVER = 'The server does not support SSL connections';

describe.each([undefined, 'disable'])('with PGSSLMODE %s', (pgSslMode) => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function settings(overrides: Record<string, string | undefined>) {
    if (pgSslMode !== undefined) vi.stubEnv('PGSSLMODE', pgSslMode);
    return { ...process.env, ...overrides };
  }

  it('refuses a server elsewhere without TPS_DB_TLS before connecting', async () => {
    await expect(prepareDatabase(settings(REMOTE), database)).rejects.toThrow(NO_TLS_SETTING);
    await expect(migrateDatabase(settings(REMOTE), database, 'up')).rejects.toThrow(NO_TLS_SETTING);
  });

  it('never falls back to plaintext with verify-full', async () => {
    const env = settings({ TPS_DB_TLS: 'verify-full' });
    await expect(prepareDatabase(env, database)).rejects.toThrow(NO_TLS_SERVER);
    await expect(migrateDatabase(env, database, 'up')).rejects.toThrow(NO_TLS_SERVER);
  });
});
