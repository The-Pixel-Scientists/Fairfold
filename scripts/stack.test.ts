// SPDX-License-Identifier: AGPL-3.0-or-later

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { publishedPort, seedEnvironment } from './stack.ts';

describe('seedEnvironment', () => {
  it("points the seed at the stack's database through the tunnel, with secrets as files", () => {
    const secrets = join('home', '.tps', 'stack', 'tps_stack_w');
    const inherited = {
      PATH: '/usr/bin',
      TPS_DB_HOST: 'db.example.org',
      Tps_Dev_Databases: 'tps_production',
      TPS_SEED_PASSWORD: 'from-the-shell',
    };
    expect(seedEnvironment(inherited, '49153', secrets)).toEqual({
      PATH: '/usr/bin',
      TPS_DEV: '1',
      TPS_DB_HOST: '127.0.0.1',
      TPS_DB_PORT: '49153',
      TPS_DB_NAME: 'tps',
      TPS_DEV_DATABASES: 'tps',
      TPS_DB_MIGRATOR_PASSWORD_FILE: join(secrets, 'TPS_STACK_MIGRATOR_PASSWORD'),
      TPS_SEED_PASSWORD_FILE: join(secrets, 'TPS_STACK_SEED_PASSWORD'),
    });
  });
});

describe('publishedPort', () => {
  it('reads a port published on this machine only', () => {
    expect(publishedPort('127.0.0.1:49153\n')).toBe('49153');
    for (const output of ['0.0.0.0:49153', '[::]:49153', '', '127.0.0.1:']) {
      expect(() => publishedPort(output), output).toThrow('Docker published the tunnel at');
    }
  });
});
