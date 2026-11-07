// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { moduleOn, switchableModuleIds } from './modules.ts';

describe('moduleOn', () => {
  it('keeps every tool off without a row, and follows the row where there is one (ADR 0024)', () => {
    for (const id of switchableModuleIds) {
      expect(moduleOn(id, undefined), id).toBe(false);
      expect(moduleOn(id, true), id).toBe(true);
      expect(moduleOn(id, false), id).toBe(false);
    }
  });

  it('keeps grants off without a row', () => {
    expect(moduleOn('grants', undefined)).toBe(false);
  });

  it('keeps the platform and party always on', () => {
    for (const id of ['platform', 'party'] as const) {
      expect(moduleOn(id, undefined), id).toBe(true);
      expect(moduleOn(id, false), id).toBe(true);
    }
  });
});
