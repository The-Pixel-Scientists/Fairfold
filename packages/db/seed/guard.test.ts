// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The seed's guard and its password, without a database: development only,
// as ADR 0005 says, with a loopback proxy to the staging database refused.
// seed.test.ts runs the seed command on each refusal, and
// seed.integration.test.ts covers the checks that need a connection.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkTarget, readSeedPassword } from './guard.ts';

const development = {
  TPS_DEV: '1',
  TPS_DB_HOST: '127.0.0.1',
  TPS_DB_PORT: '5432',
  TPS_DB_NAME: 'tps_w',
  TPS_DEV_DATABASES: 'tps_w,tps_w_test',
};

/** Staging's database name, as the services root gives it (S11-65). */
function stagingDatabase(): string {
  const file = fileURLToPath(
    new URL('../../../infra/terraform/gcp/services/variables.tf', import.meta.url),
  );
  const variable = /variable "db_name" \{[^}]*?default\s*=\s*"([^"]+)"/s.exec(
    readFileSync(file, 'utf8'),
  );
  if (!variable?.[1]) throw new Error('The services root names no staging database.');
  return variable[1];
}

describe('checkTarget', () => {
  it("allows this worktree's development database and the stack's", () => {
    expect(checkTarget(development)).toMatchObject({ database: 'tps_w' });
    expect(checkTarget({ ...development, TPS_DB_HOST: '::1' }).database).toBe('tps_w');
    expect(
      checkTarget({ ...development, TPS_DB_NAME: 'tps', TPS_DEV_DATABASES: 'tps' }).database,
    ).toBe('tps');
    expect(checkTarget(development).server.ssl).toBe(false);
  });

  it('refuses outside development', () => {
    expect(() => checkTarget({ ...development, TPS_DEV: undefined })).toThrow(
      'Refusing to seed tps_w: the seed runs only in development (TPS_DEV=1).',
    );
  });

  it('refuses a server on another machine', () => {
    for (const host of ['db.example.org', '10.0.0.5', '192.0.2.1']) {
      expect(() => checkTarget({ ...development, TPS_DB_HOST: host })).toThrow(
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
      expect(() => checkTarget({ ...development, ...other })).toThrow("it is not this worktree's");
    }
  });

  it('refuses the staging database through a proxy on this machine', () => {
    const staging = stagingDatabase();
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect(() =>
        checkTarget({ ...development, TPS_DB_HOST: host, TPS_DB_NAME: staging }),
      ).toThrow(`Refusing to seed ${staging}: it is not this worktree's`);
    }
  });

  it('has no staging mode: staging settings without TPS_DEV=1 are refused', () => {
    const staging = {
      TPS_SEED_MODE: 'staging',
      TPS_DB_HOST: '192.0.2.10',
      TPS_DB_PORT: '5432',
      TPS_DB_NAME: stagingDatabase(),
      TPS_DB_TLS: 'verify-full',
    };
    expect(() => checkTarget(staging)).toThrow('the seed runs only in development (TPS_DEV=1)');
  });

  it("refuses this worktree's test database", () => {
    expect(() => checkTarget({ ...development, TPS_DB_NAME: 'tps_w_test' })).toThrow(
      'Refusing to seed tps_w_test: it is a test database.',
    );
  });
});

describe('readSeedPassword', () => {
  it('takes a password the API would accept', () => {
    expect(readSeedPassword({ TPS_SEED_PASSWORD: 'a long synthetic passphrase' })).toBe(
      'a long synthetic passphrase',
    );
    for (const password of ['too short', 'x'.repeat(257)]) {
      expect(() => readSeedPassword({ TPS_SEED_PASSWORD: password })).toThrow(
        new Error('The seed password must be 12 to 256 characters.'),
      );
    }
    expect(() => readSeedPassword({})).toThrow('Set TPS_SEED_PASSWORD or TPS_SEED_PASSWORD_FILE.');
  });
});
