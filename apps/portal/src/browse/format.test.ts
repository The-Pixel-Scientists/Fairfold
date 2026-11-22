// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ukMoment } from './format.ts';

describe('ukMoment', () => {
  it('words a winter time in UK time', () => {
    expect(ukMoment('2027-01-14T17:00:00Z')).toBe('5pm on 14 January 2027 (UK time)');
    expect(ukMoment('2027-01-14T17:30:00Z')).toBe('5:30pm on 14 January 2027 (UK time)');
  });

  it('words a summer time an hour on from UTC', () => {
    expect(ukMoment('2027-07-01T16:00:00Z')).toBe('5pm on 1 July 2027 (UK time)');
  });

  it('follows the clocks on the days they change', () => {
    expect(ukMoment('2027-03-28T00:30:00Z')).toBe('12:30am on 28 March 2027 (UK time)');
    expect(ukMoment('2027-03-28T01:00:00Z')).toBe('2am on 28 March 2027 (UK time)');
    expect(ukMoment('2027-10-31T00:30:00Z')).toBe('1:30am on 31 October 2027 (UK time)');
    expect(ukMoment('2027-10-31T01:30:00Z')).toBe('1:30am on 31 October 2027 (UK time)');
  });

  it('calls the start of a day the end of the day before', () => {
    expect(ukMoment('2027-03-31T23:00:00Z')).toBe('midnight at the end of 31 March 2027 (UK time)');
    expect(ukMoment('2027-01-01T00:00:00Z')).toBe(
      'midnight at the end of 31 December 2026 (UK time)',
    );
  });

  it('says midday', () => {
    expect(ukMoment('2027-01-14T12:00:00Z')).toBe('midday on 14 January 2027 (UK time)');
  });

  describe('on a device set to another time zone', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('still uses UK time', () => {
      vi.stubEnv('TZ', 'Pacific/Auckland');
      expect(ukMoment('2027-07-01T16:00:00Z')).toBe('5pm on 1 July 2027 (UK time)');
      vi.stubEnv('TZ', 'America/Los_Angeles');
      expect(ukMoment('2027-01-14T17:00:00Z')).toBe('5pm on 14 January 2027 (UK time)');
    });
  });
});
