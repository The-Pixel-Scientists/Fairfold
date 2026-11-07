// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { breachClock, futureTimeProblem, icoNotificationProblem } from './breach-clock.ts';
import { privacyMessages } from './messages.ts';

const londonTime = (instant: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));

describe('the 72-hour breach clock', () => {
  it.each([
    // 09:00 BST on Saturday 24 October 2026; the clocks go back on Sunday 25 October.
    ['the end of summer time', '2026-10-24T08:00:00Z', '2026-10-27T08:00:00.000Z', '08:00'],
    // 09:00 GMT on Saturday 27 March 2027; the clocks go forward on Sunday 28 March.
    ['the start of summer time', '2027-03-27T09:00:00Z', '2027-03-30T09:00:00.000Z', '10:00'],
  ])('runs 72 elapsed hours across %s', (_, awareAt, deadline, local) => {
    expect(breachClock(awareAt, null, awareAt)).toEqual({
      deadline,
      hoursRemaining: 72,
      late: false,
    });
    expect(londonTime(deadline)).toBe(local);
  });

  it('counts whole hours left, and none once the deadline has passed', () => {
    const awareAt = '2026-11-02T09:00:00Z';
    expect(breachClock(awareAt, null, '2026-11-02T19:30:00Z').hoursRemaining).toBe(61);
    expect(breachClock(awareAt, null, '2026-11-05T09:00:00Z')).toMatchObject({
      hoursRemaining: 0,
      late: false,
    });
    expect(breachClock(awareAt, null, '2026-11-05T09:00:00.001Z')).toMatchObject({
      hoursRemaining: 0,
      late: true,
    });
  });

  it('judges a notification by when it was made, not by now', () => {
    const awareAt = '2026-11-02T09:00:00Z';
    const now = '2026-12-01T00:00:00Z';
    expect(breachClock(awareAt, '2026-11-05T09:00:00Z', now).late).toBe(false);
    expect(breachClock(awareAt, '2026-11-05T09:01:00Z', now).late).toBe(true);
  });
});

describe('times in the future', () => {
  const now = '2026-11-01T00:00:00Z';

  it('refuses an awareness or discovery time after now, which would push the deadline back', () => {
    expect(futureTimeProblem(now, '2027-01-01T00:00:00Z', '2026-10-31T00:00:00Z')).toBe(
      privacyMessages.timeInFuture,
    );
    expect(futureTimeProblem(now, '2026-10-31T00:00:00Z', '2026-11-01T00:00:00.001Z')).toBe(
      privacyMessages.timeInFuture,
    );
    expect(futureTimeProblem(now, '2026-10-31T00:00:00Z', now)).toBeNull();
  });

  it.each([
    // 01:30 BST on 25 October 2026, then 01:10 GMT 40 minutes later: earlier on the wall clock.
    ['the end of summer time', '2026-10-25T00:30:00Z', '2026-10-25T01:10:00Z', true],
    ['the end of summer time', '2026-10-25T01:10:00Z', '2026-10-25T00:30:00Z', false],
    // 00:50 GMT on 28 March 2027, then 02:10 BST 20 minutes later.
    ['the start of summer time', '2027-03-28T00:50:00Z', '2027-03-28T01:10:00Z', true],
    ['the start of summer time', '2027-03-28T01:10:00Z', '2027-03-28T00:50:00Z', false],
  ])('compares instants, not wall-clock times, across %s', (_, at, time, refused) => {
    expect(futureTimeProblem(at, time)).toBe(refused ? privacyMessages.timeInFuture : null);
  });
});

describe('recording the ICO notification', () => {
  const awareAt = '2026-11-02T09:00:00Z';
  const now = '2026-11-10T00:00:00Z';

  it.each([
    ['in time, with no reason', '2026-11-04T12:00:00Z', null, null],
    ['late, with a reason', '2026-11-06T12:00:00Z', 'still_investigating', null],
    ['late, with no reason', '2026-11-06T12:00:00Z', null, privacyMessages.lateReasonRequired],
    [
      'in time, with a reason for lateness',
      '2026-11-04T12:00:00Z',
      'still_investigating',
      privacyMessages.lateReasonNotNeeded,
    ],
    ['before becoming aware', '2026-11-01T12:00:00Z', null, privacyMessages.notifiedBeforeAware],
    ['after now', '2026-11-10T00:00:00.001Z', null, privacyMessages.timeInFuture],
    ['after now, with a reason', '2026-12-01T00:00:00Z', 'other', privacyMessages.timeInFuture],
  ])('%s', (_, notifiedAt, lateReason, problem) => {
    expect(icoNotificationProblem(awareAt, { notifiedAt, lateReason }, now)).toBe(problem);
  });

  it('accepts a notification at the moment it is recorded, across a clock change', () => {
    const at = '2026-10-25T01:10:00Z';
    const notification = { notifiedAt: at, lateReason: null };
    expect(icoNotificationProblem('2026-10-24T08:00:00Z', notification, at)).toBeNull();
    expect(
      icoNotificationProblem('2026-10-24T08:00:00Z', notification, '2026-10-25T00:30:00Z'),
    ).toBe(privacyMessages.timeInFuture);
  });
});
