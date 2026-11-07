// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkOwnDatabase } from './db.ts';
import {
  BACKUP_ROLE,
  passwordVariable,
  readAdminMode,
  readAdminRole,
  readRolePassword,
} from './roles.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** Every file under `folder`, as a path from the repository root, leaving out dependencies and builds. */
function sourceFiles(folder: string): string[] {
  return readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (!entry.isDirectory()) return [path];
    return ['node_modules', 'dist', 'generated'].includes(entry.name) ? [] : sourceFiles(path);
  });
}

describe('readAdminMode', () => {
  it('is superuser unless TPS_DB_ADMIN_MODE says managed', () => {
    expect(readAdminMode({})).toBe('superuser');
    expect(readAdminMode({ TPS_DB_ADMIN_MODE: '' })).toBe('superuser');
    expect(readAdminMode({ TPS_DB_ADMIN_MODE: 'superuser' })).toBe('superuser');
    expect(readAdminMode({ TPS_DB_ADMIN_MODE: 'managed' })).toBe('managed');
    expect(() => readAdminMode({ TPS_DB_ADMIN_MODE: 'Managed' })).toThrow(
      'TPS_DB_ADMIN_MODE must be superuser or managed.',
    );
  });
});

describe('readAdminRole', () => {
  it('names TPS_DB_SUPERUSER in managed mode, and no role in superuser mode', () => {
    expect(readAdminRole({ TPS_DB_SUPERUSER: 'postgres' })).toBeUndefined();
    expect(readAdminRole({ TPS_DB_ADMIN_MODE: 'managed', TPS_DB_SUPERUSER: 'admin' })).toBe(
      'admin',
    );
    expect(() => readAdminRole({ TPS_DB_ADMIN_MODE: 'managed' })).toThrow('Set TPS_DB_SUPERUSER.');
  });
});

describe('the backup role', () => {
  it('is named by no app, module or package outside the roles script', () => {
    const allowed = new Set([
      'packages/db/scripts/roles.sql',
      'packages/db/scripts/database-privileges.sql',
      'packages/db/scripts/roles.ts',
      'packages/db/scripts/roles.test.ts',
      'packages/db/scripts/roles.db.test.ts',
      // Database tests that check the role's grants on purpose.
      'packages/db/test/app-schema.test.ts',
      'packages/db/test/privilege-lint.test.ts',
    ]);
    const names = new RegExp(`${BACKUP_ROLE}|${passwordVariable(BACKUP_ROLE)}`, 'i');
    const naming = ['apps', 'modules', 'packages']
      .flatMap(sourceFiles)
      .filter((path) => !allowed.has(path) && names.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(naming).toEqual([]);
  });
});

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
