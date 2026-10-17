// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The seed's guard and password, and the scenarios' data, without a
// database. seed.integration.test.ts writes the scenarios.

import { brandColourSchema, defaultTheme, slugSchema } from '@pixel-scientists/domain/platform';
import { tenantNameSchema } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import { base } from './base.ts';
import { configured } from './configured.ts';
import { emailOf, hashPassword } from './scenario.ts';
import { checkTarget, readSeedPassword } from './seed.ts';

describe('checkTarget', () => {
  const env = {
    TPS_DEV: '1',
    TPS_DB_HOST: '127.0.0.1',
    TPS_DB_NAME: 'tps_w',
    TPS_DEV_DATABASES: 'tps_w,tps_w_test',
  };

  it("allows this worktree's development database and the stack's", () => {
    expect(checkTarget(env)).toBe('tps_w');
    expect(checkTarget({ ...env, TPS_DB_HOST: '::1' })).toBe('tps_w');
    expect(checkTarget({ ...env, TPS_DB_NAME: 'tps', TPS_DEV_DATABASES: 'tps' })).toBe('tps');
  });

  it('refuses outside development', () => {
    expect(() => checkTarget({ ...env, TPS_DEV: undefined })).toThrow(
      'Refusing to seed tps_w: the seed runs only in development (TPS_DEV=1).',
    );
  });

  it('refuses a server on another machine', () => {
    for (const host of ['db.example.org', '10.0.0.5', '192.0.2.1']) {
      expect(() => checkTarget({ ...env, TPS_DB_HOST: host })).toThrow(
        `Refusing to seed a database on ${host}: the seed runs only against a server on this machine.`,
      );
    }
  });

  it("refuses another worktree's database, or any when the list is empty", () => {
    for (const other of [
      { TPS_DB_NAME: 'tps_other' },
      { TPS_DEV_DATABASES: '' },
      { TPS_DEV_DATABASES: undefined },
    ]) {
      expect(() => checkTarget({ ...env, ...other })).toThrow("it is not this worktree's");
    }
  });

  it("refuses this worktree's test database", () => {
    expect(() => checkTarget({ ...env, TPS_DB_NAME: 'tps_w_test' })).toThrow(
      'Refusing to seed tps_w_test: it is a test database.',
    );
  });
});

describe('readSeedPassword', () => {
  it('takes a password the API would accept, without ever showing it', () => {
    expect(readSeedPassword({ TPS_SEED_PASSWORD: 'a long synthetic passphrase' })).toBe(
      'a long synthetic passphrase',
    );
    for (const password of ['too short', 'x'.repeat(257)]) {
      expect(() => readSeedPassword({ TPS_SEED_PASSWORD: password })).toThrow(
        'The seed password must be 12 to 256 characters.',
      );
    }
    expect(() => readSeedPassword({})).toThrow('Set TPS_SEED_PASSWORD or TPS_SEED_PASSWORD_FILE.');
  });
});

describe('hashPassword', () => {
  it('writes the PHC form auth.account accepts, with a new salt each time', () => {
    const first = hashPassword('a long synthetic passphrase');
    // The check on auth.account.password (migration 0004).
    expect(first).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}$/,
    );
    expect(hashPassword('a long synthetic passphrase')).not.toBe(first);
  });
});

describe('the scenarios', () => {
  it('give each tenant an administrator, a programme manager and two reviewers', () => {
    expect(base.map(({ slug, name }) => [slug, name])).toEqual([
      ['northfield', 'Northfield Community Trust'],
      ['eastmoor', 'Eastmoor Foundation'],
    ]);
    for (const tenant of base) {
      expect(slugSchema.safeParse(tenant.slug).success).toBe(true);
      expect(tenantNameSchema.safeParse(tenant.name).success).toBe(true);
      expect(tenant.staff.map((member) => member[2])).toEqual([
        'tenant_admin',
        'programme_manager',
        'reviewer',
        'reviewer',
      ]);
    }
  });

  it('use only .example addresses, each once', () => {
    const emails = base.flatMap((tenant) => tenant.staff.map((member) => emailOf(tenant, member)));
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(email).toMatch(/^[a-z]+\.[a-z]+@[a-z]+\.example$/);
  });

  it('give Eastmoor a brand colour of its own that passes contrast, and Northfield the default look', () => {
    const [northfield, eastmoor] = base;
    expect(northfield?.theme).toBeUndefined();
    const colour = eastmoor?.theme?.brandColour ?? '';
    expect(brandColourSchema.safeParse(colour).success).toBe(true);
    expect(colour).not.toBe(defaultTheme.brandColour);
  });

  it('configure only Northfield, on top of base', () => {
    expect(configured.map((tenant) => ({ ...tenant, programmes: undefined }))).toEqual(base);
    expect(configured.map((tenant) => tenant.programmes?.map(({ title }) => title))).toEqual([
      ['Community Spaces Fund'],
      undefined,
    ]);
  });
});
