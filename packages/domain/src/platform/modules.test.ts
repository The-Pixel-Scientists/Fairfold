// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { moduleOn, switchableModuleIds } from './modules.ts';

describe('moduleOn', () => {
  it('keeps a wave 1 tool off without a row, and follows the row where there is one (ADR 0024)', () => {
    for (const id of switchableModuleIds.filter((id) => id !== 'grants')) {
      expect(moduleOn(id, undefined), id).toBe(false);
      expect(moduleOn(id, true), id).toBe(true);
      expect(moduleOn(id, false), id).toBe(false);
    }
  });

  it('keeps grants on without a row until every tenant has one', () => {
    expect(moduleOn('grants', undefined)).toBe(true);
    expect(moduleOn('grants', false)).toBe(false);
  });

  it('keeps the platform and party always on', () => {
    for (const id of ['platform', 'party'] as const) {
      expect(moduleOn(id, undefined), id).toBe(true);
      expect(moduleOn(id, false), id).toBe(true);
    }
  });
});
