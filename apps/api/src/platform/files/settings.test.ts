// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { loadFileSettings } from './settings.ts';

describe('loadFileSettings', () => {
  const env = {
    TPS_STORAGE_ENDPOINT: 'http://127.0.0.1:8333',
    TPS_STORAGE_REGION: 'us-east-1',
    TPS_STORAGE_BUCKET: 'tps-files',
    TPS_STORAGE_WRITE_ACCESS_KEY_ID: 'writer',
    TPS_STORAGE_WRITE_SECRET_ACCESS_KEY: 'write-secret-key',
    TPS_STORAGE_READ_ACCESS_KEY_ID: 'reader',
    TPS_STORAGE_READ_SECRET_ACCESS_KEY: 'read-secret-key',
    TPS_CLAMD_HOST: '127.0.0.1',
    TPS_CLAMD_PORT: '3310',
    TPS_CLAMD_TIMEOUT_MS: '25000',
    TPS_FILES_MAX_STORES: '4',
  };

  const problemsFor = (change: Record<string, string | undefined>): string[] => {
    try {
      loadFileSettings({ ...env, ...change });
    } catch (error) {
      return (error as { problems: string[] }).problems;
    }
    return [];
  };

  it('reads every setting, and a secret from its file', () => {
    const loaded = loadFileSettings(
      {
        ...env,
        TPS_STORAGE_READ_SECRET_ACCESS_KEY: undefined,
        TPS_STORAGE_READ_SECRET_ACCESS_KEY_FILE: '/run/read',
      },
      () => 'file-secret\n',
    );
    expect(loaded.storage.endpoint.href).toBe('http://127.0.0.1:8333/');
    expect(loaded.storage.read.secretAccessKey.reveal()).toBe('file-secret');
    expect(loaded.clamd).toEqual({ host: '127.0.0.1', port: 3310, timeoutMs: 25_000 });
    expect(loaded.maxStores).toBe(4);
    expect(JSON.stringify(loaded)).not.toContain('secret-key');
  });

  it('has no fallback: each missing setting is named', () => {
    for (const name of Object.keys(env)) {
      const problems = problemsFor({ [name]: undefined });
      expect(problems.length, name).toBeGreaterThan(0);
      expect(problems.join(' '), name).toContain(name);
    }
  });

  it('reports every problem at once, without a value', () => {
    const problems = problemsFor({
      TPS_STORAGE_ENDPOINT: 'http://user:hunter2@127.0.0.1:8333/path',
      TPS_CLAMD_PORT: '0',
      TPS_CLAMD_TIMEOUT_MS: '26000',
      TPS_FILES_MAX_STORES: '10',
    });
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).not.toContain('hunter2');
  });
});
