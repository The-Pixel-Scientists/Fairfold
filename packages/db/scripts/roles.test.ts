// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkOwnDatabase } from './db.ts';
import { passwordVariable, readRolePassword } from './roles.ts';

describe('readRolePassword', () => {
  it('reads the role password from its variable', () => {
    expect(passwordVariable('app_queue')).toBe('TPS_DB_APP_QUEUE_PASSWORD');
    expect(
      readRolePassword({ TPS_DB_APP_QUEUE_PASSWORD: 'a-long-enough-password' }, 'app_queue'),
    ).toBe('a-long-enough-password');
  });

  it('refuses a password shorter than 16 characters', () => {
    expect(() => readRolePassword({ TPS_DB_MIGRATOR_PASSWORD: 'too-short' }, 'migrator')).toThrow(
      'TPS_DB_MIGRATOR_PASSWORD must be at least 16 characters.',
    );
  });

  it('accepts a development password only in development against this machine', () => {
    const env = {
      TPS_DB_MIGRATOR_PASSWORD: 'dev-migrator-password-not-a-secret',
      TPS_DB_HOST: '127.0.0.1',
    };
    expect(readRolePassword({ ...env, TPS_DEV: '1' }, 'migrator')).toBe(
      'dev-migrator-password-not-a-secret',
    );
    expect(() => readRolePassword(env, 'migrator')).toThrow('is a development password');
    for (const host of ['db.example.org', '10.0.0.5']) {
      expect(() =>
        readRolePassword({ ...env, TPS_DEV: '1', TPS_DB_HOST: host }, 'migrator'),
      ).toThrow('against a server on this machine');
    }
  });
});

describe('checkOwnDatabase', () => {
  const env = {
    TPS_DEV: '1',
    TPS_DB_HOST: '127.0.0.1',
    TPS_DEV_DATABASES: 'tps_2026_w40,tps_2026_w40_test',
  };

  it("allows this worktree's databases on this machine in development", () => {
    expect(() => {
      checkOwnDatabase(env, 'tps_2026_w40', 'drop');
    }).not.toThrow();
    expect(() => {
      checkOwnDatabase({ ...env, TPS_DB_HOST: 'localhost' }, 'tps_2026_w40_test', 'drop');
    }).not.toThrow();
  });

  it('refuses outside development', () => {
    expect(() => {
      checkOwnDatabase({ ...env, TPS_DEV: '' }, 'tps_2026_w40', 'drop');
    }).toThrow('only in development');
  });

  it('refuses a server on another machine', () => {
    expect(() => {
      checkOwnDatabase({ ...env, TPS_DB_HOST: 'db.example.org' }, 'tps_2026_w40', 'drop');
    }).toThrow('works only on this machine');
  });

  it('refuses names without the prefix', () => {
    expect(() => {
      checkOwnDatabase({ ...env, TPS_DEV_DATABASES: 'postgres' }, 'postgres', 'drop');
    }).toThrow('does not start with tps_');
  });

  it("refuses another worktree's database", () => {
    expect(() => {
      checkOwnDatabase(env, 'tps_2026_w41', 'drop');
    }).toThrow("it is not this worktree's database");
    expect(() => {
      checkOwnDatabase({ ...env, TPS_DEV_DATABASES: '' }, 'tps_2026_w40', 'drop');
    }).toThrow("it is not this worktree's database");
  });
});
