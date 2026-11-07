// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Each assumption marked GK is a question for the solicitor (S11-03, C31).

import { describe, expect, it } from 'vitest';

import {
  addCalendarMonths,
  calendarDateIn,
  clockRefusalMessages,
  clockRefusals,
  nextWorkingDay,
  ROLLS_TO_NEXT_WORKING_DAY,
  rightsRequestClock,
  type ClockEvent,
  type ClockInput,
} from './deadline.ts';

const none = new Set<string>();
const goodFriday = new Set(['2026-04-03', '2026-04-06']);

const clock = (receivedOn: string, events: ClockEvent[], today: string, nonWorkingDates = none) =>
  rightsRequestClock({ receivedOn, events, nonWorkingDates, today } satisfies ClockInput);

/** Each event is recorded on the day it is dated unless a later day is given. */
const paused = (on: string, recordedOn = on): ClockEvent => ({ kind: 'paused', on, recordedOn });
const resumed = (on: string, recordedOn = on): ClockEvent => ({ kind: 'resumed', on, recordedOn });
const closed = (on: string, recordedOn = on): ClockEvent => ({ kind: 'closed', on, recordedOn });
const extended = (on: string, months: 1 | 2 = 2, recordedOn = on): ClockEvent => ({
  kind: 'extended',
  on,
  recordedOn,
  months,
});

describe('one calendar month (GK)', () => {
  it.each([
    ['2026-01-15', 1, '2026-02-15'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2028-02-29', 1, '2028-03-29'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-08-31', 1, '2026-09-30'],
    ['2026-12-31', 1, '2027-01-31'],
    ['2026-11-30', 3, '2027-02-28'],
  ])('runs from %s by %i month(s) to %s, or the last day of a shorter month', (from, n, to) => {
    expect(addCalendarMonths(from, n)).toBe(to);
  });

  it('runs to the corresponding date, a Friday', () => {
    expect(clock('2026-03-03', [], '2026-03-10')).toEqual({
      ok: true,
      state: 'running',
      dueOn: '2026-04-03',
    });
  });

  it('counts a request received on 31 January to 28 February, rolled from Saturday', () => {
    expect(clock('2026-01-31', [], '2026-02-02')).toMatchObject({ dueOn: '2026-03-02' });
  });

  it('counts 29 February in a leap year', () => {
    expect(clock('2028-01-31', [], '2028-02-01')).toMatchObject({ dueOn: '2028-02-29' });
  });

  it('takes the received date in the tenant time zone, late on the last day of a month', () => {
    const receivedAt = '2026-04-01T02:30:00Z';
    expect(calendarDateIn(receivedAt, 'America/New_York')).toBe('2026-03-31');
    expect(calendarDateIn(receivedAt, 'UTC')).toBe('2026-04-01');
    expect(calendarDateIn('2026-05-31T23:30:00Z', 'Europe/London')).toBe('2026-06-01');
    const receivedOn = calendarDateIn(receivedAt, 'America/New_York');
    expect(clock(receivedOn, [], '2026-04-01')).toMatchObject({ dueOn: '2026-04-30' });
  });
});

describe('weekends and non-working dates (decision pending, C31)', () => {
  it('rolls to the next working day, under the named constant', () => {
    expect(ROLLS_TO_NEXT_WORKING_DAY).toBe(true);
    expect(clock('2026-03-03', [], '2026-03-10', goodFriday)).toMatchObject({
      dueOn: '2026-04-07',
    });
  });

  it.each([
    ['2026-04-01', none, '2026-04-01'],
    ['2026-04-04', none, '2026-04-06'],
    ['2026-04-03', goodFriday, '2026-04-07'],
    ['2026-12-25', new Set(['2026-12-25', '2026-12-28']), '2026-12-29'],
  ])('moves %s to %s', (date, off, to) => {
    expect(nextWorkingDay(date, off)).toBe(to);
  });
});

describe('stop the clock (DUAA 2025, GK)', () => {
  it('adds the days from asking to the answer arriving, across a month end', () => {
    const events = [paused('2026-01-28'), resumed('2026-02-04')];
    expect(clock('2026-01-13', events, '2026-02-05')).toEqual({
      ok: true,
      state: 'running',
      dueOn: '2026-02-20',
    });
  });

  it('adds every pause', () => {
    const events = [
      paused('2026-01-20'),
      resumed('2026-01-22'),
      paused('2026-02-02'),
      resumed('2026-02-05'),
    ];
    expect(clock('2026-01-13', events, '2026-02-05')).toMatchObject({ dueOn: '2026-02-18' });
  });

  it('counts nothing for an answer on the day it was asked for', () => {
    const events = [paused('2026-01-20'), resumed('2026-01-20')];
    expect(clock('2026-01-13', events, '2026-01-21')).toMatchObject({ dueOn: '2026-02-13' });
  });

  it('leaves the due date unknown while paused, rather than inventing one', () => {
    expect(clock('2026-01-13', [paused('2026-02-01')], '2026-03-30')).toEqual({
      ok: true,
      state: 'paused',
      dueOn: null,
    });
  });

  it.each([
    [
      'a resume before its pause',
      [paused('2026-02-05'), resumed('2026-02-03')],
      'resume_before_pause',
    ],
    ['a resume with no pause', [resumed('2026-02-03')], 'not_paused'],
    ['overlapping pauses', [paused('2026-02-01'), paused('2026-02-03')], 'already_paused'],
    ['a pause before the request', [paused('2026-01-12')], 'before_received'],
    [
      'an event dated before the last',
      [paused('2026-02-05'), resumed('2026-02-06'), paused('2026-02-04')],
      'out_of_order',
    ],
  ] as const)('refuses %s with a code', (_, events, refusal) => {
    expect(clock('2026-01-13', [...events], '2026-02-10')).toEqual({ ok: false, refusal });
  });
});

describe('extension (GK)', () => {
  it('adds up to two months from the received date, on or before the deadline', () => {
    for (const on of ['2026-02-10', '2026-02-13']) {
      expect(clock('2026-01-13', [extended(on)], '2026-02-20')).toEqual({
        ok: true,
        state: 'extended',
        dueOn: '2026-04-13',
      });
    }
    expect(clock('2026-01-13', [extended('2026-02-10', 1)], '2026-02-20')).toMatchObject({
      dueOn: '2026-03-13',
    });
  });

  it('counts the paused days, including an open pause, when judging whether it is late', () => {
    const events = [paused('2026-02-10'), extended('2026-02-16')];
    expect(clock('2026-01-13', events, '2026-02-16')).toMatchObject({ state: 'paused' });
  });

  it.each([
    ['after the deadline', [extended('2026-02-16')], 'extension_late'],
    ['twice', [extended('2026-02-01', 1), extended('2026-02-02', 1)], 'already_extended'],
  ] as const)('is refused %s, with a code', (_, events, refusal) => {
    expect(clock('2026-01-13', [...events], '2026-02-20')).toEqual({ ok: false, refusal });
  });
});

describe('dates in the future and backdating (GK)', () => {
  it('judges a late extension or pause by the day it is recorded, not only the day it is dated', () => {
    // Overdue from 14 February; recorded on 1 March, dated the day before the deadline.
    const late = [
      [[extended('2026-02-12', 2, '2026-03-01')], 'extension_late'],
      [[paused('2026-02-12', '2026-03-01')], 'pause_late'],
      [[paused('2026-02-16')], 'pause_late'],
    ] as const;
    for (const [events, refusal] of late) {
      expect(clock('2026-01-13', [...events], '2026-03-01')).toEqual({ ok: false, refusal });
    }
  });

  it.each([
    ['before', [resumed('2026-02-05', '2026-04-10'), extended('2026-02-05', 2, '2026-04-10')]],
    ['after', [extended('2026-02-05', 2, '2026-04-10'), resumed('2026-02-05', '2026-04-10')]],
  ] as const)('refuses an extension backdated under an open pause, resumed %s it', (_, late) => {
    // The answer arrived on 5 February, so the request was due on 17 February.
    const events = [paused('2026-02-01'), ...late];
    expect(clock('2026-01-13', events, '2026-04-10')).toEqual({
      ok: false,
      refusal: 'extension_late',
    });
  });

  it('accepts an extension dated and recorded on the same day during an open pause', () => {
    const events = [paused('2026-02-01'), extended('2026-03-20')];
    expect(clock('2026-01-13', events, '2026-03-20')).toMatchObject({ ok: true, state: 'paused' });
    expect(clock('2026-01-13', [...events, resumed('2026-03-25')], '2026-03-25')).toEqual({
      ok: true,
      state: 'extended',
      dueOn: '2026-06-04',
    });
  });

  it('accepts an extension or pause dated earlier and recorded before the deadline', () => {
    expect(clock('2026-01-13', [extended('2026-02-10', 2, '2026-02-13')], '2026-03-01')).toEqual({
      ok: true,
      state: 'extended',
      dueOn: '2026-04-13',
    });
    const events = [paused('2026-02-05', '2026-02-10'), resumed('2026-02-12')];
    expect(clock('2026-01-13', events, '2026-02-12')).toMatchObject({ dueOn: '2026-02-20' });
  });

  it.each([
    ['an event dated after the day it is recorded', [extended('2027-01-14', 2, '2026-03-01')]],
    ['an event dated after today', [paused('2026-03-02')]],
    ['an event recorded after today', [closed('2026-02-20', '2026-03-02')]],
  ] as const)('refuses %s', (_, events) => {
    expect(clock('2026-01-13', [...events], '2026-03-01')).toEqual({
      ok: false,
      refusal: 'in_future',
    });
  });

  it('refuses a request received after today', () => {
    expect(clock('2026-03-02', [], '2026-03-01')).toEqual({ ok: false, refusal: 'in_future' });
  });
});

describe('overdue and closed', () => {
  it('is overdue the day after the due date, even when extended', () => {
    expect(clock('2026-01-13', [], '2026-02-13')).toMatchObject({ state: 'running' });
    expect(clock('2026-01-13', [], '2026-02-16')).toMatchObject({
      state: 'overdue',
      dueOn: '2026-02-13',
    });
    expect(clock('2026-01-13', [extended('2026-02-01')], '2026-04-14')).toMatchObject({
      state: 'overdue',
    });
  });

  it('keeps the due date once closed, ending an open pause on the closing day', () => {
    expect(clock('2026-01-13', [closed('2026-02-02')], '2026-06-01')).toEqual({
      ok: true,
      state: 'closed',
      dueOn: '2026-02-13',
    });
    const events = [paused('2026-02-01'), closed('2026-02-05')];
    expect(clock('2026-01-13', events, '2026-06-01')).toMatchObject({ dueOn: '2026-02-17' });
  });

  it('refuses any change after closing', () => {
    expect(clock('2026-01-13', [closed('2026-02-02'), paused('2026-02-03')], '2026-02-04')).toEqual(
      { ok: false, refusal: 'after_close' },
    );
  });

  it('gives every refusal a message that says how to fix it', () => {
    expect(Object.keys(clockRefusalMessages)).toEqual([...clockRefusals]);
    for (const message of Object.values(clockRefusalMessages)) {
      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).not.toMatch(/sorry|apolog/i);
    }
  });
});
