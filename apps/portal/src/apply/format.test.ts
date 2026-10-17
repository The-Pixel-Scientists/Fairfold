// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { awardRange, closingTime, dateAndTimeOf, dateOf } from './format.ts';

describe('closingTime', () => {
  it('writes the time of day and the date, with the time zone', () => {
    expect(closingTime('2026-11-02T17:00', 'Europe/London')).toBe(
      '5pm on 2 November 2026, UK time',
    );
  });

  it('shows minutes only when there are some, and 12 for midday and midnight', () => {
    expect(closingTime('2027-03-03T17:30', 'Europe/London')).toBe(
      '5:30pm on 3 March 2027, UK time',
    );
    expect(closingTime('2027-03-03T12:00', 'Europe/London')).toBe('12pm on 3 March 2027, UK time');
    expect(closingTime('2027-03-04T00:00', 'Europe/London')).toBe('12am on 4 March 2027, UK time');
  });

  it('names a time zone other than the UK’s', () => {
    expect(closingTime('2026-11-02T09:15', 'Europe/Isle_of_Man')).toBe(
      '9:15am on 2 November 2026, Europe/Isle of Man time',
    );
  });

  it('shows a time it cannot read as it came', () => {
    expect(closingTime('soon', 'Europe/London')).toBe('soon');
  });
});

describe('awardRange', () => {
  it('writes the lowest and highest award, without pence', () => {
    expect(
      awardRange(
        { amountMinor: 500_000, currency: 'GBP' },
        { amountMinor: 2_500_000, currency: 'GBP' },
      ),
    ).toBe('£5,000 to £25,000');
  });

  it('writes one amount when the two are the same', () => {
    const amount = { amountMinor: 1_000_000, currency: 'GBP' } as const;
    expect(awardRange(amount, amount)).toBe('£10,000');
  });
});

describe('dates the API sends', () => {
  it('are written as the content style guide asks', () => {
    const noon = '2027-03-01T12:14:00';
    expect(dateOf(noon)).toBe('1 March 2027');
    expect(dateAndTimeOf(noon)).toBe('1 March 2027 at 12:14pm');
  });
});
