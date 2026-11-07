// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  closingTimeWords,
  effectiveClosingTime,
  monitoringClosingTime,
  shownMonitoringClosingTime,
  type AdjustmentTiming,
} from './closing.ts';

const ROUND = '0b5d1c4e-6f3a-4d2b-9c8e-1a2b3c4d5e6f';
const ORG = '1c6e2d5f-7a4b-4e3c-8d9f-2b3c4d5e6f70';
const APP = '2d7f3e60-8b5c-4f4d-9eaf-3c4d5e6f7081';

/** The round closes at 5pm UK time on 1 April 2027, in British Summer Time. */
const roundCloses = new Date('2027-04-01T16:00:00Z');
const application = { roundId: ROUND, organisationId: ORG, id: APP, roundClosesAt: roundCloses };

const extension = (closesAt: string, more: Partial<AdjustmentTiming> = {}): AdjustmentTiming => ({
  roundId: ROUND,
  organisationId: ORG,
  applicationId: null,
  kind: 'deadline_extension',
  closesAt: new Date(closesAt),
  revoked: false,
  ...more,
});

const before = new Date('2027-03-30T12:00:00Z');

describe('effectiveClosingTime', () => {
  it("is the round's own closing time with no adjustment", () => {
    expect(effectiveClosingTime(application, [], before)).toEqual(roundCloses);
  });

  it('is a live extension’s closing time, for the organisation or the application named', () => {
    const later = extension('2027-04-08T16:00:00Z');
    expect(effectiveClosingTime(application, [later], before)).toEqual(later.closesAt);
    const named = { ...later, applicationId: APP };
    expect(effectiveClosingTime(application, [named], before)).toEqual(later.closesAt);
    const starting = { ...application, id: null };
    expect(effectiveClosingTime(starting, [later], before)).toEqual(later.closesAt);
  });

  it('keeps an application open inside its extension, after the round closes', () => {
    const later = extension('2027-04-08T16:00:00Z');
    const now = new Date('2027-04-05T09:00:00Z');
    expect(now < effectiveClosingTime(application, [later], now)).toBe(true);
    expect(now < effectiveClosingTime(application, [], now)).toBe(false);
  });

  it('ignores an expired, revoked or unrelated extension, and an alternative route', () => {
    const now = new Date('2027-04-09T09:00:00Z');
    const ignored = [
      extension('2027-04-08T16:00:00Z'),
      extension('2027-04-20T16:00:00Z', { revoked: true }),
      extension('2027-04-20T16:00:00Z', { organisationId: APP }),
      extension('2027-04-20T16:00:00Z', { roundId: APP }),
      extension('2027-04-20T16:00:00Z', { applicationId: ORG }),
      extension('2027-04-20T16:00:00Z', { kind: 'alternative_route' }),
      { ...extension('2027-04-20T16:00:00Z', { kind: 'alternative_route' }), closesAt: null },
    ];
    expect(effectiveClosingTime(application, ignored, now)).toEqual(roundCloses);
  });

  it('takes the latest of two overlapping extensions, whatever their order', () => {
    const first = extension('2027-04-08T16:00:00Z');
    const second = extension('2027-04-15T16:00:00Z', { applicationId: APP });
    expect(effectiveClosingTime(application, [first, second], before)).toEqual(second.closesAt);
    expect(effectiveClosingTime(application, [second, first], before)).toEqual(second.closesAt);
  });

  it('closes at the closing second itself, not a second later', () => {
    const later = extension('2027-04-08T16:00:00Z');
    const lastSecond = new Date('2027-04-08T15:59:59Z');
    expect(lastSecond < effectiveClosingTime(application, [later], lastSecond)).toBe(true);
    const closing = new Date('2027-04-08T16:00:00Z');
    const at = effectiveClosingTime(application, [later], closing);
    expect(closing < at).toBe(false);
    expect(at).toEqual(roundCloses);
  });

  it('compares instants, so a change of clocks moves nothing', () => {
    // 1am UTC on 28 March 2027 is when the UK clocks go forward.
    const winter = { ...application, roundClosesAt: new Date('2027-03-28T00:30:00Z') };
    const summer = extension('2027-03-28T01:30:00Z');
    expect(effectiveClosingTime(winter, [summer], new Date('2027-03-28T01:00:00Z'))).toEqual(
      summer.closesAt,
    );
    expect(closingTimeWords(winter.roundClosesAt, 'Europe/London')).toBe(
      '12:30am UK time on 28 March 2027',
    );
    expect(closingTimeWords(summer.closesAt as Date, 'Europe/London')).toBe(
      '2:30am UK time on 28 March 2027',
    );
  });
});

describe('monitoringClosingTime', () => {
  it('is the later of the round and its last extension not revoked, even once passed', () => {
    const round = { id: ROUND, closesAt: roundCloses };
    expect(monitoringClosingTime(round, [])).toEqual(roundCloses);
    const adjustments = [
      extension('2027-04-08T16:00:00Z', { organisationId: APP }),
      extension('2027-04-20T16:00:00Z', { revoked: true }),
      extension('2027-04-03T16:00:00Z'),
    ];
    expect(monitoringClosingTime(round, adjustments)).toEqual(new Date('2027-04-08T16:00:00Z'));
  });
});

describe('shownMonitoringClosingTime', () => {
  it("leaves the round's closing time when only another organisation has an extension", () => {
    const other = extension('2027-04-08T16:00:00Z', { organisationId: APP });
    expect(shownMonitoringClosingTime(application, [other])).toEqual(roundCloses);
    const round = { id: ROUND, closesAt: roundCloses };
    expect(monitoringClosingTime(round, [other])).toEqual(other.closesAt);
  });

  it("is the application's own last extension not revoked, even once passed", () => {
    const adjustments = [
      extension('2027-04-08T16:00:00Z'),
      extension('2027-04-20T16:00:00Z', { revoked: true }),
      extension('2027-04-20T16:00:00Z', { applicationId: ORG }),
      extension('2027-04-03T16:00:00Z', { applicationId: APP }),
    ];
    expect(shownMonitoringClosingTime(application, adjustments)).toEqual(
      new Date('2027-04-08T16:00:00Z'),
    );
  });
});

describe('closingTimeWords', () => {
  it('words a time in UK time, in winter and summer', () => {
    expect(closingTimeWords(roundCloses, 'Europe/London')).toBe('5pm UK time on 1 April 2027');
    expect(closingTimeWords(new Date('2026-11-02T09:30:00Z'), 'Europe/London')).toBe(
      '9:30am UK time on 2 November 2026',
    );
    expect(closingTimeWords(new Date('2027-01-15T12:00:00Z'), 'Europe/London')).toBe(
      'midday UK time on 15 January 2027',
    );
    expect(closingTimeWords(new Date('2027-01-15T00:00:00Z'), 'Europe/London')).toBe(
      'midnight UK time at the start of 15 January 2027',
    );
  });

  it('names any other zone', () => {
    expect(closingTimeWords(roundCloses, 'Europe/Paris')).toBe(
      '6pm Europe/Paris time on 1 April 2027',
    );
  });
});
