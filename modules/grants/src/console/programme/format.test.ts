// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  clock,
  formatAwards,
  formatLocal,
  formatLocalDay,
  formatMoment,
  splitLocal,
} from './format.ts';

const pounds = (amountMinor: number) => ({ amountMinor, currency: 'GBP' }) as const;

describe('clock', () => {
  it('writes times as the content style guide does', () => {
    expect(clock(9, 0)).toBe('9am');
    expect(clock(17, 30)).toBe('5:30pm');
    expect(clock(0, 5)).toBe('12:05am');
    expect(clock(12, 0)).toBe('12pm');
  });
});

describe('a round time, local to its time zone', () => {
  it('reads the date and time from the text, without a time zone shifting them', () => {
    expect(formatLocal('2026-10-12T09:00')).toBe('12 October 2026 at 9am');
    expect(formatLocal('2027-03-28T01:30')).toBe('28 March 2027 at 1:30am');
    expect(formatLocalDay('2026-11-02T17:00')).toBe('2 November 2026');
  });

  it('splits into the date and the time a form holds', () => {
    expect(splitLocal('2026-10-12T09:00')).toEqual({ date: '2026-10-12', time: '09:00' });
    expect(splitLocal('12 October')).toBeNull();
  });

  it('shows text of another form as it is', () => {
    expect(formatLocal('soon')).toBe('soon');
    expect(formatLocalDay('soon')).toBe('soon');
  });
});

describe('formatMoment', () => {
  it('shows a moment in the time zone given, across a change of day and of clocks', () => {
    expect(formatMoment('2026-10-12T22:30:00.000Z', 'Europe/London')).toBe(
      '12 October 2026 at 11:30pm',
    );
    expect(formatMoment('2026-10-12T22:30:00.000Z', 'Asia/Tokyo')).toBe(
      '13 October 2026 at 7:30am',
    );
    expect(formatMoment('2027-01-05T09:00:00.000Z', 'Europe/London')).toBe('5 January 2027 at 9am');
  });

  it('shows midnight as 12am, not 24', () => {
    expect(formatMoment('2026-10-12T23:00:00.000Z', 'Europe/London')).toBe(
      '13 October 2026 at 12am',
    );
  });
});

describe('formatAwards', () => {
  it('writes the range in pounds', () => {
    expect(formatAwards(pounds(500_000), pounds(2_500_000))).toBe('£5,000 to £25,000');
  });
});
