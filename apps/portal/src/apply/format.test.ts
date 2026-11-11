// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
  awardRange,
  closingTime,
  dateAndTimeOf,
  dateOf,
  deadlineOf,
  hasMoreTime,
  ukTimeOf,
} from './format.ts';

describe('closingTime', () => {
  it('writes the time of day and the date, with the time zone', () => {
    expect(closingTime('2026-11-02T17:00', 'Europe/London')).toBe(
      '5pm on 2 November 2026, UK time',
    );
  });

  it('shows minutes only when there are some, and words midday and midnight', () => {
    expect(closingTime('2027-03-03T17:30', 'Europe/London')).toBe(
      '5:30pm on 3 March 2027, UK time',
    );
    expect(closingTime('2027-03-03T12:00', 'Europe/London')).toBe(
      'midday on 3 March 2027, UK time',
    );
    expect(closingTime('2027-03-01T00:00', 'Europe/London')).toBe(
      'midnight at the end of 28 February 2027, UK time',
    );
    expect(closingTime('2027-04-01T00:00', 'Europe/London')).toBe(
      'midnight at the end of 31 March 2027, UK time',
    );
  });

  it('writes winter, summer and clock-change days as the wall clock says', () => {
    expect(closingTime('2027-01-14T17:00', 'Europe/London')).toBe(
      '5pm on 14 January 2027, UK time',
    );
    expect(closingTime('2027-07-01T17:00', 'Europe/London')).toBe('5pm on 1 July 2027, UK time');
    expect(closingTime('2027-03-28T17:00', 'Europe/London')).toBe('5pm on 28 March 2027, UK time');
    expect(closingTime('2027-10-31T17:00', 'Europe/London')).toBe(
      '5pm on 31 October 2027, UK time',
    );
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

describe('deadlineOf and hasMoreTime', () => {
  const round = { closesAt: '2027-03-01T17:00', timeZone: 'Europe/London' };

  it('use the application’s closing time when the server sends one', () => {
    const extended = { round, closesAt: '2027-03-15T17:00' };
    expect(deadlineOf(extended)).toBe('5pm on 15 March 2027, UK time');
    expect(hasMoreTime(extended)).toBe(true);
  });

  it('use the round’s when there is no other, or the same, time', () => {
    expect(deadlineOf({ round })).toBe('5pm on 1 March 2027, UK time');
    expect(hasMoreTime({ round })).toBe(false);
    expect(hasMoreTime({ round, closesAt: round.closesAt })).toBe(false);
  });
});

describe('ukTimeOf', () => {
  it('writes UK time in winter and summer', () => {
    expect(ukTimeOf('2027-01-14T14:14:00Z')).toBe('14 January 2027 at 2:14pm, UK time');
    expect(ukTimeOf('2027-07-01T14:14:00Z')).toBe('1 July 2027 at 3:14pm, UK time');
  });

  it('is the same on a device set to another time zone', () => {
    vi.stubEnv('TZ', 'Pacific/Auckland');
    try {
      expect(ukTimeOf('2027-01-14T14:14:00Z')).toBe('14 January 2027 at 2:14pm, UK time');
      expect(closingTime('2027-01-14T17:00', 'Europe/London')).toBe(
        '5pm on 14 January 2027, UK time',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
