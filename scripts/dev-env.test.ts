// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  developmentValues,
  ensureSecretFile,
  isLoopbackHost,
  profileEnvironment,
  viteEnvironment,
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
    mailpit: {
      ports: [{ target: 1025, published: '51025', host_ip: '127.0.0.1' }],
      environment: { MP_SMTP_AUTH: 'smtp-user:smtp-password:for-tests' },
    },
  },
};
const names = {
  database: 'tps_w',
  testDatabase: 'tps_w_test',
  ports: { api: 41230, console: 41231, portal: 41232 },
};
const secrets = join('home', '.tps', 'dev', 'tps_w');
const values = developmentValues(config, names, secrets);

function ours(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('TPS_')));
}
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

  it('gives the API its port, database, app passwords, origins, proxies, auth secret file and Mailpit only', () => {
    const env = profileEnvironment('api', values, [], {}, own);
    expect(ours(env)).toEqual({
      TPS_DEV: '1',
      TPS_DB_HOST: '127.0.0.1',
      TPS_DB_PORT: '55432',
      TPS_DB_NAME: 'tps_w',
      TPS_DB_APP_API_PASSWORD: 'app-api-password-for-tests',
      TPS_DB_APP_AUTH_PASSWORD: 'app-auth-password-for-tests',
      TPS_API_PORT: '41230',
      TPS_API_TRUST_PROXY: '127.0.0.1,::1',
      TPS_AUTH_SECRET_FILE: join(secrets, 'auth_secret'),
      TPS_CONSOLE_ORIGIN: 'http://console.localhost:41231',
      TPS_PORTAL_ORIGIN: 'http://portal.localhost:41232',
      TPS_SMTP_HOST: '127.0.0.1',
      TPS_SMTP_PORT: '51025',
      TPS_SMTP_TLS: 'none',
      TPS_SMTP_USER: 'smtp-user',
      TPS_SMTP_PASSWORD: 'smtp-password:for-tests',
      TPS_SMTP_FROM: 'no-reply@example.org',
    });
  });

  it('gives the seed migrator, the seed password file and the own-database list, and no app role', () => {
    const env = profileEnvironment('seed', values, [], {}, own);
    expect(ours(env)).toEqual({
      TPS_DEV: '1',
      TPS_DB_HOST: '127.0.0.1',
      TPS_DB_PORT: '55432',
      TPS_DB_NAME: 'tps_w',
      TPS_DB_MIGRATOR_PASSWORD: 'migrator-password-for-tests',
      TPS_SEED_PASSWORD_FILE: join(secrets, 'seed_password'),
      TPS_DEV_DATABASES: 'tps_w,tps_w_test',
    });
  });

  it('gives the operator command app_worker, the console origin and Mailpit only', () => {
    const env = profileEnvironment('operator', values, [], {}, own);
    expect(Object.keys(ours(env))).toEqual([
      'TPS_DEV',
      'TPS_DB_HOST',
      'TPS_DB_PORT',
      'TPS_DB_NAME',
      'TPS_DB_APP_WORKER_PASSWORD',
      'TPS_CONSOLE_ORIGIN',
      'TPS_SMTP_HOST',
      'TPS_SMTP_PORT',
      'TPS_SMTP_TLS',
      'TPS_SMTP_USER',
      'TPS_SMTP_PASSWORD',
      'TPS_SMTP_FROM',
    ]);
  });

  it('refuses a Mailpit login that is not user:password', () => {
    const broken: ComposeConfig = {
      services: {
        ...config.services,
        mailpit: { ...config.services?.['mailpit'], environment: { MP_SMTP_AUTH: 'no-colon' } },
      },
    };
    expect(() => developmentValues(broken, names, secrets)).toThrow('MP_SMTP_AUTH');
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

describe('viteEnvironment', () => {
  it('gives a Vite dev server the API origin and no other TPS_ variable', () => {
    const inherited = {
      PATH: '/usr/bin',
      TPS_AUTH_SECRET: 'from-the-shell',
      tps_api_origin: 'http://attacker.example',
      VITE_FLAG: '1',
    };
    expect(viteEnvironment(inherited, 41230)).toEqual({
      PATH: '/usr/bin',
      VITE_FLAG: '1',
      TPS_API_ORIGIN: 'http://127.0.0.1:41230',
    });
  });
});

describe('ensureSecretFile', () => {
  it('makes a random secret once and keeps it', () => {
    const folder = mkdtempSync(join(tmpdir(), 'tps-dev-env-'));
    try {
      const path = join(folder, 'dev', 'auth_secret');
      ensureSecretFile(path);
      const secret = readFileSync(path, 'utf8');
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      ensureSecretFile(path);
      expect(readFileSync(path, 'utf8')).toBe(secret);

      const other = join(folder, 'dev', 'seed_password');
      writeFileSync(other, 'set-by-hand');
      ensureSecretFile(other);
      expect(readFileSync(other, 'utf8')).toBe('set-by-hand');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
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
