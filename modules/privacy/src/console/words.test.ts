// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { RightsRequest } from '../contracts/index.ts';

import {
  breachClockText,
  clockText,
  deadlinePassed,
  formatDate,
  formatMoment,
  instantFrom,
  localInput,
} from './words.ts';

const id = '00000000-0000-4000-8000-000000000001';
const recorded = { membershipId: id, recordedAt: '2027-01-04T09:00:00.000Z' };

describe('clockText', () => {
  it('counts the days left on a running clock', () => {
    expect(clockText({ state: 'running', dueOn: '2027-01-12' }, '2027-01-04')).toBe(
      'Due 12 January 2027 (8 days left)',
    );
    expect(clockText({ state: 'running', dueOn: '2027-01-12' }, '2027-01-11')).toBe(
      'Due 12 January 2027 (1 day left)',
    );
    expect(clockText({ state: 'running', dueOn: '2027-01-12' }, '2027-01-12')).toBe(
      'Due 12 January 2027 (today)',
    );
  });

  it('says how late an overdue request is', () => {
    expect(clockText({ state: 'overdue', dueOn: '2027-01-12' }, '2027-01-15')).toBe(
      'Overdue by 3 days',
    );
  });

  it('names the stop date and reason, and invents no due date', () => {
    const events: RightsRequest['clockEvents'] = [
      { kind: 'paused', on: '2027-01-04', reason: 'identity_proof', ...recorded },
    ];
    const text = clockText({ state: 'paused', dueOn: null }, '2027-01-10', events);
    expect(text).toBe('Clock stopped on 4 January 2027: waiting for proof of identity');
    expect(clockText({ state: 'paused', dueOn: null }, '2027-01-10')).toContain('not known');
  });

  it('shows the extended date and a closed request', () => {
    expect(clockText({ state: 'extended', dueOn: '2027-03-12' }, '2027-01-10')).toBe(
      'Extended to 12 March 2027',
    );
    expect(clockText({ state: 'closed', dueOn: '2027-01-12' }, '2027-01-20')).toBe('Closed');
  });
});

describe('breachClockText', () => {
  const becameAwareAt = '2026-12-06T15:15:00.000Z';
  const open = { becameAwareAt, icoNotified: false, late: false };

  it('counts hours to the deadline in the funder time zone', () => {
    expect(breachClockText(open, '2026-12-07T15:30:00.000Z', 'Europe/London')).toBe(
      '47 hours left to tell the ICO, by 3:15pm on 9 December 2026',
    );
  });

  it('says less than an hour in the last hour', () => {
    expect(breachClockText(open, '2026-12-09T14:45:00.000Z', 'Europe/London')).toBe(
      'Less than 1 hour left to tell the ICO, by 3:15pm on 9 December 2026',
    );
  });

  it('says how long ago the deadline passed', () => {
    expect(breachClockText(open, '2026-12-09T20:15:00.000Z', 'Europe/London')).toBe(
      'ICO deadline passed 5 hours ago',
    );
    expect(deadlinePassed(becameAwareAt, '2026-12-09T15:16:00.000Z')).toBe(true);
    expect(deadlinePassed(becameAwareAt, '2026-12-09T15:14:00.000Z')).toBe(false);
  });

  it('counts hours, not days, across the end of British Summer Time', () => {
    const aware = '2026-10-23T12:00:00.000Z';
    expect(
      breachClockText(
        { ...open, becameAwareAt: aware },
        '2026-10-25T12:00:00.000Z',
        'Europe/London',
      ),
    ).toBe('24 hours left to tell the ICO, by 12:00pm on 26 October 2026');
  });

  it('reports a notified breach without a countdown', () => {
    expect(
      breachClockText({ ...open, icoNotified: true }, '2026-12-08T00:00:00.000Z', 'Europe/London'),
    ).toBe('ICO told');
  });
});

describe('times in the funder time zone', () => {
  it('formats dates and moments', () => {
    expect(formatDate('2027-04-01')).toBe('1 April 2027');
    expect(formatMoment('2026-07-01T14:05:00.000Z', 'Europe/London')).toBe('3:05pm on 1 July 2026');
  });

  it('turns a typed local time into an instant, either side of a clock change', () => {
    expect(instantFrom('2026-07-01T15:05', 'Europe/London')).toBe('2026-07-01T14:05:00.000Z');
    expect(instantFrom('2026-12-01T15:05', 'Europe/London')).toBe('2026-12-01T15:05:00.000Z');
    expect(instantFrom('2027-03-28T02:30', 'Europe/London')).not.toBeNull();
    expect(instantFrom('not a time', 'Europe/London')).toBeNull();
  });

  it('turns an instant back into a local time', () => {
    expect(localInput('2026-07-01T14:05:00.000Z', 'Europe/London')).toBe('2026-07-01T15:05');
  });
});
