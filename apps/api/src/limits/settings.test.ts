// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { ConfigError } from '../config.ts';
import { loadLimitSettings } from './settings.ts';

const KEY = 'x'.repeat(32);

const problems = (env: Record<string, string>): readonly string[] => {
  try {
    loadLimitSettings(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
};

describe('loadLimitSettings', () => {
  it('reads a key of at least 32 bytes', () => {
    expect(loadLimitSettings({ TPS_REQUEST_LIMIT_KEY: KEY }).key.reveal()).toBe(KEY);
  });

  it('refuses a missing key outside development, naming the variable', () => {
    expect(problems({})).toEqual(['Set TPS_REQUEST_LIMIT_KEY or TPS_REQUEST_LIMIT_KEY_FILE.']);
  });

  it('refuses a short key, even in development, without showing it', () => {
    const found = problems({ TPS_REQUEST_LIMIT_KEY: 'short', TPS_DEV: '1' });
    expect(found).toEqual(['TPS_REQUEST_LIMIT_KEY must be at least 32 bytes.']);
  });

  it('refuses a development value outside development', () => {
    const key = `${KEY}-not-a-secret`;
    expect(problems({ TPS_REQUEST_LIMIT_KEY: key })).toHaveLength(1);
    expect(problems({ TPS_REQUEST_LIMIT_KEY: key, TPS_DEV: '1' })).toEqual([]);
  });

  it('makes a key of its own in development when none is set, a different one each time', () => {
    const first = loadLimitSettings({ TPS_DEV: '1' }).key.reveal();
    expect(Buffer.byteLength(first)).toBeGreaterThanOrEqual(32);
    expect(loadLimitSettings({ TPS_DEV: '1' }).key.reveal()).not.toBe(first);
  });
});
