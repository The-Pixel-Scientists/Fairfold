// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './cursor.ts';

const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

describe('page cursors', () => {
  it('round-trip an id, in 22 URL-safe characters', () => {
    const cursor = encodeCursor(ID);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(decodeCursor(cursor)).toBe(ID);
  });

  it('refuse anything else', () => {
    for (const bad of ['abc_123', ID, '', `${encodeCursor(ID)}A`, 'AAAAAAAAAAAAAAAAAAAAAB']) {
      expect(decodeCursor(bad), bad).toBeNull();
    }
  });
});
