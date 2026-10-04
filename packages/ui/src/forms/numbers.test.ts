// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { dateAnswer, dateParts } from './dates.ts';
import { amountAnswer, amountText, numberAnswer, numberText } from './numbers.ts';

describe('numberAnswer', () => {
  it.each([
    ['12', 12],
    ['-3', -3],
    ['0', 0],
    ['1,250', 1250],
    ['1,250,000.5', 1_250_000.5],
    ['  7  ', 7],
    ['0.25', 0.25],
  ])('reads %j as %j', (typed, answer) => {
    expect(numberAnswer(typed)).toBe(answer);
  });

  it('gives null for blank text', () => {
    expect(numberAnswer('')).toBeNull();
    expect(numberAnswer('   ')).toBeNull();
  });

  it.each(['abc', '12.', '1,25', '1e3', '12 000', '--1', '.5', '£5'])(
    'passes %j on as typed, so the engine can refuse it',
    (typed) => {
      expect(numberAnswer(typed)).toBe(typed);
    },
  );
});

describe('numberText', () => {
  it('shows a number, or the text that was typed in its place', () => {
    expect(numberText(12.5)).toBe('12.5');
    expect(numberText('12.')).toBe('12.');
    expect(numberText(null)).toBe('');
    expect(numberText({})).toBe('');
  });
});

describe('amountAnswer', () => {
  it.each([
    ['25000', 2_500_000],
    ['25,000', 2_500_000],
    ['£25,000', 2_500_000],
    ['£ 25,000.50', 2_500_050],
    ['12.5', 1250],
    ['0.07', 7],
    ['0', 0],
  ])('reads %j as %j pence', (typed, amountMinor) => {
    expect(amountAnswer(typed)).toEqual({ amountMinor, currency: 'GBP' });
  });

  it('gives null for blank text, or for a bare £ sign', () => {
    expect(amountAnswer('')).toBeNull();
    expect(amountAnswer('£')).toBeNull();
  });

  it.each(['abc', '12.345', '-5', '1,25', '12.', '£5 million', '9'.repeat(20)])(
    'passes %j on as typed',
    (typed) => {
      expect(amountAnswer(typed)).toBe(typed);
    },
  );
});

describe('amountText', () => {
  it('shows pounds without pence when there are none, and two places when there are', () => {
    expect(amountText({ amountMinor: 2_500_000, currency: 'GBP' })).toBe('25000');
    expect(amountText({ amountMinor: 1250, currency: 'GBP' })).toBe('12.50');
    expect(amountText({ amountMinor: 7, currency: 'GBP' })).toBe('0.07');
  });

  it('shows what was typed in place of an amount, and nothing for no answer', () => {
    expect(amountText('12.345')).toBe('12.345');
    expect(amountText(null)).toBe('');
    expect(amountText({ currency: 'GBP' })).toBe('');
  });
});

describe('dateAnswer', () => {
  it('gives a date with the month and day padded', () => {
    expect(dateAnswer({ day: '1', month: '4', year: '2027' })).toBe('2027-04-01');
    expect(dateAnswer({ day: ' 27 ', month: '03', year: '2027' })).toBe('2027-03-27');
  });

  it('gives a date that is not real, for the engine to refuse', () => {
    expect(dateAnswer({ day: '31', month: '2', year: '2027' })).toBe('2027-02-31');
  });

  it('gives null for empty boxes', () => {
    expect(dateAnswer({ day: '', month: ' ', year: '' })).toBeNull();
  });

  it('passes on what is typed when a box is incomplete or not digits', () => {
    expect(dateAnswer({ day: '1', month: '', year: '' })).toBe('--1');
    expect(dateAnswer({ day: '1', month: '4', year: '27' })).toBe('27-4-1');
    expect(dateAnswer({ day: 'first', month: '4', year: '2027' })).toBe('2027-4-first');
  });
});

describe('dateParts', () => {
  it('splits a date into the boxes, without leading zeros', () => {
    expect(dateParts('2027-03-07')).toEqual({ day: '7', month: '3', year: '2027' });
  });

  it('splits what was typed in the same order', () => {
    expect(dateParts('27-4-1')).toEqual({ day: '1', month: '4', year: '27' });
    expect(dateParts('--1')).toEqual({ day: '1', month: '', year: '' });
  });

  it('leaves the boxes empty for no answer or for anything else', () => {
    const empty = { day: '', month: '', year: '' };
    expect(dateParts(null)).toEqual(empty);
    expect(dateParts(5)).toEqual(empty);
    expect(dateParts('27 March')).toEqual(empty);
    expect(dateParts('1-2-3-4')).toEqual(empty);
  });
});
