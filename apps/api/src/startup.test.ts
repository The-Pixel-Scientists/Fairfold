// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// Each test starts a new Node.js process, which is slow on a cold start.
vi.setConfig({ testTimeout: 30_000 });

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/** The inherited environment, without any Fairfold Grants setting, plus `settings`. */
function environment(settings: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.toUpperCase().startsWith('TPS_')) env[key] = value;
  }
  return { ...env, ...settings };
}

function start(settings: Record<string, string>) {
  return spawnSync(process.execPath, [MAIN], {
    env: environment(settings),
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('starting the API', () => {
  it('exits with status 1 and names each missing variable, before it opens a port', () => {
    const result = start({});

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    for (const name of [
      'TPS_API_HOST',
      'TPS_API_PORT',
      'TPS_DB_HOST',
      'TPS_DB_PORT',
      'TPS_DB_NAME',
      'TPS_DB_APP_API_PASSWORD',
    ]) {
      expect(result.stderr).toContain(`Set ${name}`);
    }
  });

  it('prints a message, not a stack trace', () => {
    const result = start({ TPS_API_PORT: 'not-a-port' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TPS_API_PORT must be a port number from 1 to 65535.');
    expect(result.stderr).not.toMatch(/\bat .*\(.*:\d+:\d+\)/);
    expect(result.stderr).not.toContain('node_modules');
  });

  it('does not print a secret it was given', () => {
    const result = start({ TPS_DB_APP_API_PASSWORD: 'short-SECRET' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TPS_DB_APP_API_PASSWORD must be at least 16 characters.');
    expect(result.stderr).not.toContain('SECRET');
  });
});
