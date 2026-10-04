// SPDX-License-Identifier: AGPL-3.0-or-later
//
// createDatabase() and its driver settings. The poolConfig() tests need no
// database; the createDatabase() tests connect to the test database.

import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import {
  CLIENT_ROLES,
  createDatabase,
  poolConfig,
  type ClientRole,
  type DatabaseSettings,
  type DatabaseTls,
} from '../src/database.ts';
import { databaseSettings } from './connect.ts';

const settings: DatabaseSettings = {
  host: '127.0.0.1',
  port: 5432,
  database: 'tps',
  role: 'app_api',
  password: 'a-password-for-tests',
  applicationName: 'tps-tests',
};

describe('poolConfig', () => {
  it('connects without TLS to a server on this machine, and sets every option itself', () => {
    expect(poolConfig(settings)).toEqual({
      host: '127.0.0.1',
      port: 5432,
      database: 'tps',
      user: 'app_api',
      password: 'a-password-for-tests',
      application_name: 'tps-tests',
      max: 10,
      connectionTimeoutMillis: 10_000,
      query_timeout: 35_000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      // An explicit false, so PGSSLMODE cannot turn TLS on or off.
      ssl: false,
      // Likewise PGSSLNEGOTIATION.
      sslnegotiation: 'postgres',
      // Always set, so PGOPTIONS cannot add settings.
      options: '-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000',
    });
  });

  it('takes the limits and timeouts given', () => {
    const config = poolConfig({
      ...settings,
      maxConnections: 3,
      connectionTimeoutMillis: 2_000,
      statementTimeoutMillis: 1_234,
      idleInTransactionTimeoutMillis: 5_678,
      queryTimeoutMillis: 4_000,
      keepAliveInitialDelayMillis: 3_000,
    });
    expect(config).toMatchObject({
      max: 3,
      connectionTimeoutMillis: 2_000,
      query_timeout: 4_000,
      keepAliveInitialDelayMillis: 3_000,
      options: '-c statement_timeout=1234 -c idle_in_transaction_session_timeout=5678',
    });
  });

  it('refuses a server elsewhere without TLS settings', () => {
    expect(() => poolConfig({ ...settings, host: 'db.internal' })).toThrow(
      'Set tls.mode for the database server at db.internal to verify-full, or to disable on a private network. Only a server on this machine is reached without TLS by default.',
    );
  });

  it('checks the server certificate and host name with verify-full', () => {
    const elsewhere = { ...settings, host: 'db.internal' };
    expect(poolConfig({ ...elsewhere, tls: { mode: 'verify-full' } }).ssl).toEqual({
      rejectUnauthorized: true,
    });
    expect(poolConfig({ ...elsewhere, tls: { mode: 'verify-full', ca: 'PEM' } }).ssl).toEqual({
      rejectUnauthorized: true,
      ca: 'PEM',
    });
  });

  it('connects in clear to a server elsewhere only when told to', () => {
    expect(poolConfig({ ...settings, host: 'postgres', tls: { mode: 'disable' } }).ssl).toBe(false);
  });

  it('refuses a TLS mode it does not know', () => {
    const tls = { mode: 'require' } as unknown as DatabaseTls;
    expect(() => poolConfig({ ...settings, tls })).toThrow('Set tls.mode');
  });

  it.each([
    ['password', { password: '' }],
    ['host', { host: '' }],
    ['database name', { database: '' }],
  ])('refuses an empty %s', (_, change) => {
    expect(() => poolConfig({ ...settings, ...change })).toThrow(
      'Set the database host, name and password. None of them may be empty.',
    );
  });

  it.each([0, 65_536, 1.5, Number.NaN])('refuses port %s', (port) => {
    expect(() => poolConfig({ ...settings, port })).toThrow(
      'The database port must be a whole number from 1 to 65535.',
    );
  });

  it.each([
    { statementTimeoutMillis: -1 },
    { statementTimeoutMillis: 1.5 },
    { idleInTransactionTimeoutMillis: Number.NaN },
    { queryTimeoutMillis: -5 },
    { keepAliveInitialDelayMillis: 2.5 },
  ])('refuses the timeout in %o', (change) => {
    expect(() => poolConfig({ ...settings, ...change })).toThrow(
      'The database timeouts must be whole numbers of milliseconds.',
    );
  });

  it.each(['migrator', 'app_queue', 'postgres'])('refuses to connect as %s', (role) => {
    expect(() => poolConfig({ ...settings, role: role as ClientRole })).toThrow(
      'The database client connects only as app_api, app_worker, app_auth.',
    );
  });
});

describe('createDatabase', () => {
  it.each(CLIENT_ROLES)('connects as %s, which cannot bypass row-level security', async (role) => {
    const db = createDatabase(databaseSettings(role, 1));
    try {
      const { rows } = await sql<{ role: string; superuser: boolean; bypass_rls: boolean }>`
        SELECT current_user AS role, rolsuper AS superuser, rolbypassrls AS bypass_rls
          FROM pg_catalog.pg_roles WHERE rolname = current_user
      `.execute(db);
      expect(rows).toEqual([{ role, superuser: false, bypass_rls: false }]);
    } finally {
      await db.destroy();
    }
  });

  it('stops waiting for a query that runs past the query timeout', async () => {
    const db = createDatabase({
      ...databaseSettings('app_api', 1),
      statementTimeoutMillis: 0,
      queryTimeoutMillis: 200,
    });
    try {
      await expect(sql`SELECT pg_catalog.pg_sleep(2)`.execute(db)).rejects.toThrow(
        'Query read timeout',
      );
    } finally {
      await db.destroy();
    }
  });

  it('starts every session with the timeouts given', async () => {
    const db = createDatabase({
      ...databaseSettings('app_api', 1),
      statementTimeoutMillis: 1_234,
      idleInTransactionTimeoutMillis: 5_678,
    });
    try {
      const { rows } = await sql<{ statement: string; idle: string }>`
        SELECT pg_catalog.current_setting('statement_timeout') AS statement,
               pg_catalog.current_setting('idle_in_transaction_session_timeout') AS idle
      `.execute(db);
      expect(rows).toEqual([{ statement: '1234ms', idle: '5678ms' }]);
    } finally {
      await db.destroy();
    }
  });
});
