// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkDroppable } from './db.ts';
import { passwordVariable, readRolePassword } from './roles.ts';

describe('readRolePassword', () => {
  it('reads the role password from its variable', () => {
    expect(passwordVariable('app_queue')).toBe('PIXELGRANT_DB_APP_QUEUE_PASSWORD');
    expect(
      readRolePassword({ PIXELGRANT_DB_APP_QUEUE_PASSWORD: 'a-long-enough-password' }, 'app_queue'),
    ).toBe('a-long-enough-password');
  });

  it('refuses a password shorter than 16 characters', () => {
    expect(() =>
      readRolePassword({ PIXELGRANT_DB_MIGRATOR_PASSWORD: 'too-short' }, 'migrator'),
    ).toThrow('PIXELGRANT_DB_MIGRATOR_PASSWORD must be at least 16 characters.');
  });

  it('accepts a development password only in development against this machine', () => {
    const env = {
      PIXELGRANT_DB_MIGRATOR_PASSWORD: 'dev-migrator-password-not-a-secret',
      PIXELGRANT_DB_HOST: '127.0.0.1',
    };
    expect(readRolePassword({ ...env, PIXELGRANT_DEV: '1' }, 'migrator')).toBe(
      'dev-migrator-password-not-a-secret',
    );
    expect(() => readRolePassword(env, 'migrator')).toThrow('is a development password');
    for (const host of ['db.example.org', '10.0.0.5']) {
      expect(() =>
        readRolePassword({ ...env, PIXELGRANT_DEV: '1', PIXELGRANT_DB_HOST: host }, 'migrator'),
      ).toThrow('against a server on this machine');
    }
  });
});

describe('checkDroppable', () => {
  const env = {
    PIXELGRANT_DEV: '1',
    PIXELGRANT_DB_HOST: '127.0.0.1',
    PIXELGRANT_DEV_DATABASES: 'pixelgrant_2026_w40,pixelgrant_2026_w40_test',
  };

  it("allows this worktree's databases on this machine in development", () => {
    expect(() => {
      checkDroppable(env, 'pixelgrant_2026_w40');
    }).not.toThrow();
    expect(() => {
      checkDroppable({ ...env, PIXELGRANT_DB_HOST: 'localhost' }, 'pixelgrant_2026_w40_test');
    }).not.toThrow();
  });

  it('refuses outside development', () => {
    expect(() => {
      checkDroppable({ ...env, PIXELGRANT_DEV: '' }, 'pixelgrant_2026_w40');
    }).toThrow('only in development');
  });

  it('refuses a server on another machine', () => {
    expect(() => {
      checkDroppable({ ...env, PIXELGRANT_DB_HOST: 'db.example.org' }, 'pixelgrant_2026_w40');
    }).toThrow('works only on this machine');
  });

  it('refuses names without the prefix', () => {
    expect(() => {
      checkDroppable({ ...env, PIXELGRANT_DEV_DATABASES: 'postgres' }, 'postgres');
    }).toThrow('does not start with pixelgrant_');
  });

  it("refuses another worktree's database", () => {
    expect(() => {
      checkDroppable(env, 'pixelgrant_2026_w41');
    }).toThrow("it is not this worktree's database");
    expect(() => {
      checkDroppable({ ...env, PIXELGRANT_DEV_DATABASES: '' }, 'pixelgrant_2026_w40');
    }).toThrow("it is not this worktree's database");
  });
});
