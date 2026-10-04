// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { moduleIds } from '../modules.ts';
import { configDiffSchemas, configEntityTypes } from './config.ts';

const SHA256 = 'a'.repeat(64);

describe('configuration entity types', () => {
  it('are named <module>.<entity>, as app.config_version checks', () => {
    for (const type of configEntityTypes) {
      expect(type).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(moduleIds).toContain(type.split('.')[0]);
    }
    expect(Object.keys(configDiffSchemas)).toEqual([...configEntityTypes]);
  });
});

describe('configuration diffs', () => {
  it('list each changed field with its old and new values', () => {
    const cases = {
      'platform.tenant': [
        { field: 'name', from: 'Northfield', to: 'Northfield Trust' },
        { field: 'fiscalYearStartMonth', from: 4, to: 1 },
      ],
      'platform.theme': [
        { field: 'brandColour', from: '#1f4bb8', to: '#7a2e8c' },
        { field: 'logo', from: null, to: { type: 'image/png', sha256: SHA256 } },
      ],
      'platform.module': [{ field: 'enabled', from: true, to: false }],
    } as const;
    for (const type of configEntityTypes) {
      expect(configDiffSchemas[type].parse(cases[type])).toEqual(cases[type]);
    }
  });

  it('refuse empty diffs, unknown fields, mismatched values and logo bytes', () => {
    const refused = {
      'platform.tenant': [[], [{ field: 'slug', from: 'a', to: 'b' }]],
      'platform.theme': [
        [{ field: 'brandColour', from: '#1f4bb8', to: 'red' }],
        [{ field: 'logo', from: null, to: { type: 'image/png', sha256: SHA256, bytes: 'iVBO' } }],
        [{ field: 'logo', from: null, to: { type: 'image/svg+xml', sha256: SHA256 } }],
      ],
      'platform.module': [[], [{ field: 'enabled', from: 'on', to: 'off' }]],
    };
    for (const type of configEntityTypes) {
      for (const diff of refused[type]) {
        expect(configDiffSchemas[type].safeParse(diff).success, JSON.stringify(diff)).toBe(false);
      }
    }
  });
});
