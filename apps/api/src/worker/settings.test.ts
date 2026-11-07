// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ConfigError } from '../config.ts';
import { loadWorkerSettings } from './settings.ts';

const env = {
  TPS_DB_HOST: '127.0.0.1',
  TPS_DB_PORT: '5432',
  TPS_DB_NAME: 'pixelgrant',
  TPS_DB_APP_WORKER_PASSWORD: 'worker-password-0123456789',
  TPS_DB_APP_QUEUE_PASSWORD: 'queue-password-0123456789',
};

function problems(values: Record<string, string | undefined>): readonly string[] {
  try {
    loadWorkerSettings(values);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('the worker settings', () => {
  it('reads the two passwords and needs no API, mail or auth setting', () => {
    const settings = loadWorkerSettings(env);
    expect(settings.workerPassword.reveal()).toBe(env.TPS_DB_APP_WORKER_PASSWORD);
    expect(settings.queuePassword.reveal()).toBe(env.TPS_DB_APP_QUEUE_PASSWORD);
    expect(JSON.stringify(settings)).not.toContain('password-0123456789');
  });

  it('never reads the API password, whatever the environment holds', () => {
    const settings = loadWorkerSettings({
      ...env,
      TPS_DB_APP_API_PASSWORD: 'api-password-0123456789',
    });
    expect(JSON.stringify(settings)).not.toContain('api-password');
    expect(Object.values(settings).map(String).join()).not.toContain('api-password');
  });

  it('names every missing or short setting', () => {
    const found = problems({ TPS_DB_APP_QUEUE_PASSWORD: 'short' });
    expect(found.join('\n')).toContain('TPS_DB_HOST');
    expect(found.join('\n')).toContain('TPS_DB_APP_WORKER_PASSWORD');
    expect(found.join('\n')).toContain('TPS_DB_APP_QUEUE_PASSWORD must be at least');
  });

  it('refuses a development password away from a development server', () => {
    expect(
      problems({ ...env, TPS_DB_APP_WORKER_PASSWORD: 'dev-password-not-a-secret' }).join(),
    ).toContain('development password');
  });
});

describe('starting the worker', () => {
  const entry = fileURLToPath(new URL('../worker.ts', import.meta.url));
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('TPS_')),
  );

  it('exits with status 1 and says which setting is missing, before any connection', () => {
    const result = spawnSync(process.execPath, [entry], {
      env: clean,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('TPS_DB_APP_QUEUE_PASSWORD');
  }, 30_000);

  it('refuses to start with a proxy variable set', () => {
    const result = spawnSync(process.execPath, [entry], {
      env: { ...clean, HTTPS_PROXY: 'http://proxy.example.org:3128' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).not.toBe(0);
  }, 30_000);
});
