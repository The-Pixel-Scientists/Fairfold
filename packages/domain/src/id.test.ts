// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { idSchema } from './index.ts';

describe('idSchema', () => {
  it('accepts a UUID', () => {
    expect(idSchema.safeParse('0b7c4a1e-5d2f-4c8e-9a3b-6f1d2e4c8a90').success).toBe(true);
  });

  it('rejects anything that is not a UUID', () => {
    for (const value of ['', '42', 'not-a-uuid', '0b7c4a1e5d2f4c8e9a3b6f1d2e4c8a90']) {
      expect(idSchema.safeParse(value).success).toBe(false);
    }
  });
});
