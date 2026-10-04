// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { bucketName, databaseNames, devNames, fitName, portBlocks, slugify } from './dev-names.ts';

describe('slugify', () => {
  it('lower-cases and replaces everything outside [a-z0-9_] with an underscore', () => {
    expect(slugify('2026-w40')).toBe('2026_w40');
    expect(slugify('PixelGrant')).toBe('pixelgrant');
    expect(slugify('Fix bug #12 (é)')).toBe('fix_bug__12____');
  });
});

describe('databaseNames', () => {
  it('follows the documented pattern', () => {
    expect(databaseNames('2026_w40')).toEqual({
      database: 'tps_2026_w40',
      testDatabase: 'tps_2026_w40_test',
    });
  });

  it('keeps long names within 63 bytes, distinct and prefixed', () => {
    const a = databaseNames(`${'a'.repeat(70)}_one`);
    const b = databaseNames(`${'a'.repeat(70)}_two`);
    for (const name of [a.database, a.testDatabase, b.database, b.testDatabase]) {
      expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
      expect(name.startsWith('tps_')).toBe(true);
    }
    expect(a.database).not.toBe(b.database);
    expect(a.testDatabase).not.toBe(b.testDatabase);
    expect(a.testDatabase.endsWith('_test')).toBe(true);
  });
});

describe('fitName', () => {
  it('leaves short names alone', () => {
    expect(fitName('tps_x', 63, '_')).toBe('tps_x');
  });

  it('replaces the tail of a long name with a hash', () => {
    const name = fitName('x'.repeat(100), 63, '_');
    expect(name).toHaveLength(63);
    expect(name).toMatch(/^x{54}_[0-9a-f]{8}$/);
  });
});

describe('bucketName', () => {
  it('uses hyphens, as S3 requires', () => {
    expect(bucketName('2026_w40')).toBe('tps-2026-w40');
  });

  it('never ends in a hyphen, and keeps trimmed names distinct', () => {
    const trimmed = bucketName('feature_');
    expect(trimmed).toMatch(/^tps-feature-[0-9a-f]{8}$/);
    expect(trimmed).not.toBe(bucketName('feature'));
  });

  it('stays within 63 characters', () => {
    expect(bucketName('b'.repeat(100)).length).toBeLessThanOrEqual(63);
  });
});

describe('portBlocks', () => {
  it('gives every worktree its own block', () => {
    const slugs = Array.from({ length: 200 }, (_, index) => `worktree_${index}`);
    const blocks = portBlocks(slugs);
    expect(new Set(blocks.values()).size).toBe(200);
  });

  it('does not depend on the order worktrees are listed in', () => {
    expect(portBlocks(['a', 'b', 'c'])).toEqual(portBlocks(['c', 'a', 'b']));
  });
});

describe('devNames', () => {
  it('returns every name for a worktree', () => {
    const names = devNames('2026-w40', ['PixelGrant']);
    expect(names).toMatchObject({
      worktree: '2026-w40',
      database: 'tps_2026_w40',
      testDatabase: 'tps_2026_w40_test',
      bucket: 'tps-2026-w40',
    });
    expect(names.ports.console).toBe(names.ports.api + 1);
    expect(names.ports.portal).toBe(names.ports.api + 2);
    expect(names.ports.api).toBeGreaterThanOrEqual(41000);
    expect(names.ports.portal).toBeLessThan(49000);
  });

  it('never gives two worktrees the same ports', () => {
    const a = devNames('2026-w40', ['2026-w41']);
    const b = devNames('2026-w41', ['2026-w40']);
    expect(a.ports.api).not.toBe(b.ports.api);
  });

  it('refuses two worktrees whose names would collide', () => {
    expect(() => devNames('2026-w40', ['2026_W40'])).toThrow('would share database names');
  });
});
