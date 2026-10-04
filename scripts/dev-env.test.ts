// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  developmentValues,
  isLoopbackHost,
  profileEnvironment,
  type ComposeConfig,
} from './dev-env.ts';

const config: ComposeConfig = {
  services: {
    postgres: {
      ports: [{ target: 5432, published: '55432', host_ip: '127.0.0.1' }],
      environment: {
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'superuser-password-for-tests',
        TPS_DB_MIGRATOR_PASSWORD: 'migrator-password-for-tests',
        TPS_DB_APP_API_PASSWORD: 'app-api-password-for-tests',
        TPS_DB_APP_WORKER_PASSWORD: 'app-worker-password-for-tests',
        TPS_DB_APP_AUTH_PASSWORD: 'app-auth-password-for-tests',
        TPS_DB_APP_QUEUE_PASSWORD: 'app-queue-password-for-tests',
      },
    },
  },
};
const names = {
  database: 'tps_w',
  testDatabase: 'tps_w_test',
  ports: { api: 41230 },
};
const values = developmentValues(config, names);
const own = [names.database, names.testDatabase];

describe('profileEnvironment', () => {
  it('gives database-admin the superuser, every role password and the own-database list', () => {
    const env = profileEnvironment('database-admin', values, [], {}, own);
    expect(env).toMatchObject({
      TPS_DEV: '1',
      TPS_DB_HOST: '127.0.0.1',
      TPS_DB_PORT: '55432',
      TPS_DB_NAME: 'tps_w',
      TPS_DB_SUPERUSER_PASSWORD: 'superuser-password-for-tests',
      TPS_DB_APP_QUEUE_PASSWORD: 'app-queue-password-for-tests',
      TPS_DEV_DATABASES: 'tps_w,tps_w_test',
    });
  });

  it('gives database-tests no superuser and only the test database', () => {
    const env = profileEnvironment('database-tests', values, [], {}, own);
    expect(env['TPS_DB_SUPERUSER']).toBeUndefined();
    expect(env['TPS_DB_SUPERUSER_PASSWORD']).toBeUndefined();
    expect(env['TPS_DB_NAME']).toBeUndefined();
    expect(env['TPS_TEST_DB_NAME']).toBe('tps_w_test');
  });

  it('gives the API its port, the worktree database and the app_api password only', () => {
    const env = profileEnvironment('api', values, [], {}, own);
    expect(
      Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('TPS_'))),
    ).toEqual({
      TPS_DEV: '1',
      TPS_DB_HOST: '127.0.0.1',
      TPS_DB_PORT: '55432',
      TPS_DB_NAME: 'tps_w',
      TPS_DB_APP_API_PASSWORD: 'app-api-password-for-tests',
      TPS_API_PORT: '41230',
    });
  });

  it('drops inherited TPS_ variables outside the profile and keeps the rest', () => {
    const inherited = { PATH: '/usr/bin', TPS_DB_SUPERUSER_PASSWORD: 'from-the-shell' };
    const env = profileEnvironment('database-tests', values, [inherited], inherited, own);
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['TPS_DB_SUPERUSER_PASSWORD']).toBeUndefined();
  });

  it('drops them in any letter case, as Windows ignores case in variable names', () => {
    const inherited = {
      Path: 'C:\\Windows',
      tps_db_superuser_password: 'from-the-shell',
      Tps_Dev_Databases: 'tps_production',
    };
    const env = profileEnvironment('database-tests', values, [inherited], inherited, own);
    expect(env['Path']).toBe('C:\\Windows');
    expect(Object.keys(env).filter((key) => key.toUpperCase().startsWith('TPS_'))).toEqual([
      'TPS_DEV',
      'TPS_DB_HOST',
      'TPS_DB_PORT',
      'TPS_TEST_DB_NAME',
      'TPS_DB_MIGRATOR_PASSWORD',
      'TPS_DB_APP_API_PASSWORD',
      'TPS_DB_APP_WORKER_PASSWORD',
      'TPS_DB_APP_AUTH_PASSWORD',
      'TPS_DB_APP_QUEUE_PASSWORD',
    ]);
  });

  it('lets the environment override .env, and .env override the development value', () => {
    const dotEnv = { TPS_DB_PORT: '6543', TPS_DB_HOST: 'localhost' };
    const shell = { TPS_DB_PORT: '7654', TPS_DB_HOST: '' };
    const env = profileEnvironment('database-tests', values, [dotEnv, shell], shell, own);
    expect(env['TPS_DB_PORT']).toBe('7654');
    expect(env['TPS_DB_HOST']).toBe('localhost');
  });

  it('refuses a database server that is not on this machine', () => {
    for (const host of ['db.example.org', '10.0.0.5', '127.0.0.1.nip.io']) {
      const dotEnv = { TPS_DB_HOST: host };
      expect(() => profileEnvironment('database-admin', values, [dotEnv], {}, own)).toThrow(
        `TPS_DB_HOST is ${host}. The development commands work only against a database server on this machine.`,
      );
    }
  });

  it('never lets anything override the own-database list', () => {
    const shell = { TPS_DEV_DATABASES: 'tps_production' };
    const env = profileEnvironment('database-admin', values, [shell], shell, own);
    expect(env['TPS_DEV_DATABASES']).toBe('tps_w,tps_w_test');
  });
});

describe('isLoopbackHost', () => {
  it('accepts only this machine', () => {
    expect(['localhost', '127.0.0.1', '127.3.2.1', '::1', '[::1]'].every(isLoopbackHost)).toBe(
      true,
    );
    expect(
      ['db.example.org', '10.0.0.5', '0.0.0.0', 'localhost.example.org'].some(isLoopbackHost),
    ).toBe(false);
  });
});
