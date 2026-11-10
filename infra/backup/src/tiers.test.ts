// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';

import { BackupError } from './codes.ts';
import {
  addMonths,
  assertWithinTier,
  datePrefix,
  retainUntil,
  snapshotIdFor,
  tierFor,
} from './tiers.ts';
import { describe, it } from './testing.ts';

const at = (text: string) => new Date(text);

describe('tierFor', () => {
  it('keeps 1 January for 7 years and every other 1st for 12 months', () => {
    assert.equal(tierFor(at('2027-01-01T02:00:00Z')), 'yearly');
    assert.equal(tierFor(at('2027-02-01T02:00:00Z')), 'monthly');
    assert.equal(tierFor(at('2027-12-01T02:00:00Z')), 'monthly');
    assert.equal(tierFor(at('2027-01-02T02:00:00Z')), 'daily');
    assert.equal(tierFor(at('2027-02-28T23:59:59Z')), 'daily');
  });

  it('reads the date in UTC, not the local date around midnight', () => {
    // Already the 1st in London during British Summer Time.
    assert.equal(tierFor(at('2026-06-30T23:30:00Z')), 'daily');
    // Already 1 January east of Greenwich.
    assert.equal(tierFor(at('2026-12-31T23:30:00Z')), 'daily');
    assert.equal(tierFor(at('2027-01-01T00:00:00Z')), 'yearly');
  });

  it('does not promote the next snapshot after a missed 1st', () => {
    assert.equal(tierFor(at('2027-01-02T02:00:00Z')), 'daily');
    assert.equal(tierFor(at('2027-03-02T02:00:00Z')), 'daily');
  });

  it('gives a re-run on the same day the same tier', () => {
    assert.equal(tierFor(at('2027-01-01T02:00:00Z')), tierFor(at('2027-01-01T09:40:00Z')));
  });
});

describe('retainUntil', () => {
  it('adds 35 days across month ends', () => {
    assert.deepEqual(retainUntil(at('2026-01-31T02:00:00Z'), 'daily'), at('2026-03-07T02:00:00Z'));
    assert.deepEqual(retainUntil(at('2026-12-15T02:00:00Z'), 'daily'), at('2027-01-19T02:00:00Z'));
  });

  it('counts 29 February in leap years and not otherwise', () => {
    assert.deepEqual(retainUntil(at('2028-02-10T02:00:00Z'), 'daily'), at('2028-03-16T02:00:00Z'));
    assert.deepEqual(retainUntil(at('2027-02-10T02:00:00Z'), 'daily'), at('2027-03-17T02:00:00Z'));
  });

  it('keeps a monthly snapshot for 12 calendar months', () => {
    assert.deepEqual(
      retainUntil(at('2028-02-01T02:00:00Z'), 'monthly'),
      at('2029-02-01T02:00:00Z'),
    );
  });

  it('keeps a yearly snapshot for 7 calendar years across leap years', () => {
    assert.deepEqual(retainUntil(at('2027-01-01T02:00:00Z'), 'yearly'), at('2034-01-01T02:00:00Z'));
  });

  it('is exact to the second across clock changes', () => {
    // The nights the clocks change in the UK in 2026.
    assert.deepEqual(retainUntil(at('2026-03-29T01:30:00Z'), 'daily'), at('2026-05-03T01:30:00Z'));
    assert.deepEqual(retainUntil(at('2026-10-25T01:30:00Z'), 'daily'), at('2026-11-29T01:30:00Z'));
  });
});

describe('addMonths', () => {
  it('rolls forward, never back, when the month is shorter', () => {
    assert.deepEqual(addMonths(at('2028-02-29T02:00:00Z'), 12), at('2029-03-01T02:00:00Z'));
  });
});

describe('assertWithinTier', () => {
  const start = at('2027-01-01T02:00:00Z');

  it('allows the tier date and up to one day past it', () => {
    assertWithinTier(start, 'yearly', at('2034-01-01T02:00:00Z'));
    assertWithinTier(start, 'yearly', at('2034-01-02T02:00:00Z'));
  });

  it('refuses a later date', () => {
    assert.throws(
      () => {
        assertWithinTier(start, 'yearly', at('2034-01-02T02:00:01Z'));
      },
      (error: unknown) => error instanceof BackupError && error.code === 'retain_date_refused',
    );
    assert.throws(() => {
      assertWithinTier(at('2027-02-10T02:00:00Z'), 'daily', at('2027-03-19T02:00:00Z'));
    }, BackupError);
  });
});

describe('snapshot ids', () => {
  it('sort by time and start with the UTC date', () => {
    const early = snapshotIdFor(at('2026-11-08T02:00:00Z'), 'aaaa');
    const late = snapshotIdFor(at('2026-11-08T09:40:12Z'), '0000');
    assert.equal(early, '20261108T020000Z-aaaa');
    assert.ok(early < late);
    assert.ok(early.startsWith(datePrefix(at('2026-11-08T23:59:00Z'))));
  });
});
