// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { formatMoment, fromUkInput, toUkInput } from './format.ts';

describe('formatMoment', () => {
  it('writes UK time in the content style', () => {
    expect(formatMoment('2027-02-02T09:00:00Z')).toBe('2 February 2027 at 9am');
    expect(formatMoment('2027-07-01T16:30:00Z')).toBe('1 July 2027 at 5:30pm');
    expect(formatMoment('2027-07-01T11:00:00Z')).toBe('1 July 2027 at 12pm');
  });
});

describe('fromUkInput and toUkInput', () => {
  it('sends UTC for winter and summer time', () => {
    expect(fromUkInput('2027-02-02T09:00')).toBe('2027-02-02T09:00:00Z');
    expect(fromUkInput('2027-07-01T09:00')).toBe('2027-07-01T08:00:00Z');
  });

  it('keeps the night the clocks go forward', () => {
    expect(fromUkInput('2027-03-27T23:30')).toBe('2027-03-27T23:30:00Z');
    expect(fromUkInput('2027-03-28T02:30')).toBe('2027-03-28T01:30:00Z');
    expect(toUkInput('2027-03-28T01:30:00Z')).toBe('2027-03-28T02:30');
  });

  it('keeps the night the clocks go back', () => {
    expect(fromUkInput('2027-10-31T00:30')).toBe('2027-10-30T23:30:00Z');
    expect(fromUkInput('2027-10-31T02:00')).toBe('2027-10-31T02:00:00Z');
    expect(toUkInput('2027-10-31T02:00:00Z')).toBe('2027-10-31T02:00');
  });

  it('reads seconds, and refuses text that is not a time', () => {
    expect(fromUkInput('2027-02-02T23:59:59')).toBe('2027-02-02T23:59:59Z');
    expect(fromUkInput('tomorrow')).toBeNull();
    expect(toUkInput(null)).toBe('');
  });
});
