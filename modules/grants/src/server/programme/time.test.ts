// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { instantAt, localAt } from './time.ts';

const London = 'Europe/London';

describe('instantAt', () => {
  it('reads a local time in the zone, with the summer offset in summer and none in winter', () => {
    expect(instantAt(London, '2027-02-02T09:00')?.toISOString()).toBe('2027-02-02T09:00:00.000Z');
    expect(instantAt(London, '2027-06-02T09:00')?.toISOString()).toBe('2027-06-02T08:00:00.000Z');
  });

  it('keeps 9am to 5pm either side of the clock change on 25 October 2026', () => {
    expect(instantAt(London, '2026-10-24T09:00')?.toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(instantAt(London, '2026-10-26T09:00')?.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    expect(instantAt(London, '2026-11-03T17:00')?.toISOString()).toBe('2026-11-03T17:00:00.000Z');
  });

  it('takes the first of two instants when the clocks go back, and refuses the hour they skip', () => {
    expect(instantAt(London, '2026-10-25T01:30')?.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(instantAt(London, '2027-03-28T00:59')?.toISOString()).toBe('2027-03-28T00:59:00.000Z');
    expect(instantAt(London, '2027-03-28T01:30')).toBeNull();
    expect(instantAt(London, '2027-03-28T02:00')?.toISOString()).toBe('2027-03-28T01:00:00.000Z');
  });

  it('reads zones west of Greenwich, with half hours, and UTC', () => {
    expect(instantAt('America/New_York', '2027-02-02T09:00')?.toISOString()).toBe(
      '2027-02-02T14:00:00.000Z',
    );
    expect(instantAt('Asia/Kolkata', '2027-02-02T09:00')?.toISOString()).toBe(
      '2027-02-02T03:30:00.000Z',
    );
    expect(instantAt('UTC', '2027-02-02T09:00')?.toISOString()).toBe('2027-02-02T09:00:00.000Z');
  });

  it('refuses a date that is not on the calendar or a year the clock cannot show', () => {
    expect(instantAt(London, '2027-02-30T09:00')).toBeNull();
    expect(instantAt(London, '0050-02-02T09:00')).toBeNull();
  });
});

describe('localAt', () => {
  it('shows the local time in the round’s own zone', () => {
    const opens = new Date('2026-10-20T08:00:00Z');
    const closes = new Date('2026-11-03T17:00:00Z');

    expect(localAt(London, opens)).toBe('2026-10-20T09:00');
    expect(localAt(London, closes)).toBe('2026-11-03T17:00');
    expect(localAt('America/New_York', opens)).toBe('2026-10-20T04:00');
  });

  it('gives back what instantAt read, for every minute of the two days around a clock change', () => {
    for (const start of ['2026-10-24T00:00', '2027-03-27T00:00']) {
      const first = Date.parse(`${start}:00Z`);
      for (let minute = 0; minute < 3 * 24 * 60; minute += 1) {
        const local = new Date(first + minute * 60_000).toISOString().slice(0, 16);
        const instant = instantAt(London, local);
        if (instant !== null) expect(localAt(London, instant)).toBe(local);
      }
    }
  });
});
