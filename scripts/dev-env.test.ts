// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { developmentValues, profileEnvironment, type ComposeConfig } from './dev-env.ts';

const config: ComposeConfig = {
  services: {
    postgres: {
      ports: [{ target: 5432, published: '55432', host_ip: '127.0.0.1' }],
      environment: {
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'superuser-password-for-tests',
        PIXELGRANT_DB_MIGRATOR_PASSWORD: 'migrator-password-for-tests',
        PIXELGRANT_DB_APP_API_PASSWORD: 'app-api-password-for-tests',
        PIXELGRANT_DB_APP_WORKER_PASSWORD: 'app-worker-password-for-tests',
        PIXELGRANT_DB_APP_AUTH_PASSWORD: 'app-auth-password-for-tests',
        PIXELGRANT_DB_APP_QUEUE_PASSWORD: 'app-queue-password-for-tests',
      },
    },
  },
};
const names = { database: 'pixelgrant_w', testDatabase: 'pixelgrant_w_test' };
const values = developmentValues(config, names);
const own = [names.database, names.testDatabase];

describe('profileEnvironment', () => {
  it('gives database-admin the superuser, every role password and the own-database list', () => {
    const env = profileEnvironment('database-admin', values, [], {}, own);
    expect(env).toMatchObject({
      PIXELGRANT_DEV: '1',
      PIXELGRANT_DB_HOST: '127.0.0.1',
      PIXELGRANT_DB_PORT: '55432',
      PIXELGRANT_DB_NAME: 'pixelgrant_w',
      PIXELGRANT_DB_SUPERUSER_PASSWORD: 'superuser-password-for-tests',
      PIXELGRANT_DB_APP_QUEUE_PASSWORD: 'app-queue-password-for-tests',
      PIXELGRANT_DEV_DATABASES: 'pixelgrant_w,pixelgrant_w_test',
    });
  });

  it('gives database-tests no superuser and only the test database', () => {
    const env = profileEnvironment('database-tests', values, [], {}, own);
    expect(env['PIXELGRANT_DB_SUPERUSER']).toBeUndefined();
    expect(env['PIXELGRANT_DB_SUPERUSER_PASSWORD']).toBeUndefined();
    expect(env['PIXELGRANT_DB_NAME']).toBeUndefined();
    expect(env['PIXELGRANT_TEST_DB_NAME']).toBe('pixelgrant_w_test');
  });

  it('drops inherited PIXELGRANT_ variables outside the profile and keeps the rest', () => {
    const inherited = { PATH: '/usr/bin', PIXELGRANT_DB_SUPERUSER_PASSWORD: 'from-the-shell' };
    const env = profileEnvironment('database-tests', values, [inherited], inherited, own);
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['PIXELGRANT_DB_SUPERUSER_PASSWORD']).toBeUndefined();
  });

  it('lets the environment override .env, and .env override the development value', () => {
    const dotEnv = { PIXELGRANT_DB_PORT: '6543', PIXELGRANT_DB_HOST: 'db.internal' };
    const shell = { PIXELGRANT_DB_PORT: '7654', PIXELGRANT_DB_HOST: '' };
    const env = profileEnvironment('database-tests', values, [dotEnv, shell], shell, own);
    expect(env['PIXELGRANT_DB_PORT']).toBe('7654');
    expect(env['PIXELGRANT_DB_HOST']).toBe('db.internal');
  });

  it('never lets anything override the own-database list', () => {
    const shell = { PIXELGRANT_DEV_DATABASES: 'pixelgrant_production' };
    const env = profileEnvironment('database-admin', values, [shell], shell, own);
    expect(env['PIXELGRANT_DEV_DATABASES']).toBe('pixelgrant_w,pixelgrant_w_test');
  });
});
