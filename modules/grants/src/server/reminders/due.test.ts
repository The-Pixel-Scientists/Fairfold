// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { addLondonDays, draftDue, plan, reviewDue } from './due.ts';

const at = (text: string) => new Date(text);
const iso = (date: Date) => date.toISOString();

describe('stepping London calendar days', () => {
  it('keeps the clock time across the end of British Summer Time (25 October 2026)', () => {
    // 12:00 on 27 October is GMT; seven days earlier is 20 October, still BST.
    expect(iso(addLondonDays(at('2026-10-27T12:00:00Z'), -7))).toBe('2026-10-20T11:00:00.000Z');
    // 12:00 BST on 20 October, seven days on, is 12:00 GMT.
    expect(iso(addLondonDays(at('2026-10-20T11:00:00Z'), 7))).toBe('2026-10-27T12:00:00.000Z');
  });

  it('keeps the clock time across the start of British Summer Time (28 March 2027)', () => {
    expect(iso(addLondonDays(at('2027-03-31T11:00:00Z'), -3))).toBe('2027-03-28T11:00:00.000Z');
    expect(iso(addLondonDays(at('2027-03-31T11:00:00Z'), -4))).toBe('2027-03-27T12:00:00.000Z');
    expect(iso(addLondonDays(at('2027-03-30T11:00:00Z'), -7))).toBe('2027-03-23T12:00:00.000Z');
  });

  it('moves a time that does not exist forward rather than failing', () => {
    // 01:30 on 28 March 2027 never happens in London.
    expect(iso(addLondonDays(at('2027-03-29T00:30:00Z'), -1))).toBe('2027-03-28T01:30:00.000Z');
  });

  it('is a day of 24 hours in a month with no change', () => {
    expect(iso(addLondonDays(at('2026-12-10T09:15:30.250Z'), -14))).toBe(
      '2026-11-26T09:15:30.250Z',
    );
  });
});

describe('the reminders of a draft', () => {
  const closes = at('2027-01-15T12:00:00Z');

  it('fall due that many days before it closes, keyed by the number of days', () => {
    expect(
      draftDue(closes, [14, 7, 1]).map(({ occurrence, dueAt }) => [occurrence, iso(dueAt)]),
    ).toEqual([
      [14, '2027-01-01T12:00:00.000Z'],
      [7, '2027-01-08T12:00:00.000Z'],
      [1, '2027-01-14T12:00:00.000Z'],
    ]);
  });

  it('move with an extension granted after one was sent', () => {
    const extended = at('2027-01-22T12:00:00Z');
    expect(iso(draftDue(closes, [7])[0]?.dueAt as Date)).toBe('2027-01-08T12:00:00.000Z');
    expect(iso(draftDue(extended, [7])[0]?.dueAt as Date)).toBe('2027-01-15T12:00:00.000Z');
    // Nothing is due at the old time once the closing time has moved.
    expect(plan(draftDue(extended, [7]), at('2027-01-08T12:00:00Z'))).toEqual({
      send: null,
      superseded: [],
    });
  });
});

describe('the reminders of a review', () => {
  it('start after the delay and repeat at the interval, up to three', () => {
    const due = reviewDue(at('2026-11-02T10:00:00Z'), 14, 7);
    expect(due.map(({ occurrence, dueAt }) => [occurrence, iso(dueAt)])).toEqual([
      [1, '2026-11-16T10:00:00.000Z'],
      [2, '2026-11-23T10:00:00.000Z'],
      [3, '2026-11-30T10:00:00.000Z'],
    ]);
  });
});

describe('what a run does', () => {
  const due = draftDue(at('2027-01-15T12:00:00Z'), [14, 7, 1]);

  it('sends nothing before the first is due, and at the boundary minute sends it', () => {
    expect(plan(due, at('2027-01-01T11:59:59Z'))).toEqual({ send: null, superseded: [] });
    expect(plan(due, at('2027-01-01T12:00:00Z'))).toEqual({ send: 14, superseded: [] });
  });

  it('sends only the one nearest the closing time when several are due, superseding the rest', () => {
    expect(plan(due, at('2027-01-10T09:00:00Z'))).toEqual({ send: 7, superseded: [14] });
    expect(plan(due, at('2027-01-14T12:00:00Z'))).toEqual({ send: 1, superseded: [7, 14] });
  });
});
