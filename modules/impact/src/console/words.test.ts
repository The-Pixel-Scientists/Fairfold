// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  figureText,
  formatDay,
  formatFigure,
  formatPeriod,
  parseFigure,
  progressPercent,
} from './words.ts';

const summary = (value: number | null, target: number | null, baseline: number | null = null) => ({
  indicatorId: '5c0f2f0e-1c5b-4b0a-9a39-0c0c3f1f6d11',
  value,
  resultCount: value === null ? 0 : 1,
  latestPeriodEnd: null,
  target,
  baseline,
});

describe('figures', () => {
  it('shows money in pounds, percentages with a sign and other numbers with separators', () => {
    expect(formatFigure('money', 2_500_000)).toBe('£25,000');
    expect(formatFigure('money', 1250)).toBe('£12.50');
    expect(formatFigure('percentage', 62.5)).toBe('62.5%');
    expect(formatFigure('count', 12_345)).toBe('12,345');
    expect(formatFigure('hours', 1)).toBe('1 hour');
    expect(formatFigure('hours', 7.5)).toBe('7.5 hours');
  });

  it('types money in pounds and everything else as stored', () => {
    expect(figureText('money', 1250)).toBe('12.5');
    expect(figureText('people', 40)).toBe('40');
  });

  it('reads money in pounds into pence', () => {
    expect(parseFigure('money', '£1,250.50'.replace('£', ''))).toEqual({ value: 125_050 });
    expect(parseFigure('money', '3')).toEqual({ value: 300 });
  });

  it('says what is wrong with a figure, in words about the box', () => {
    expect(parseFigure('count', '')).toEqual({ problem: 'Enter a figure, such as 120.' });
    expect(parseFigure('count', 'lots')).toEqual({
      problem: 'Enter a figure using digits only, such as 120.',
    });
    expect(parseFigure('money', '1.234')).toEqual({
      problem: 'Enter an amount in pounds, with up to 2 decimal places, such as 2500.50.',
    });
    expect(parseFigure('people', '1.5')).toEqual({ problem: 'Enter a whole number.' });
    expect(parseFigure('percentage', '101')).toEqual({
      problem: 'Enter a percentage from 0 to 100, with up to 2 decimal places.',
    });
    expect(parseFigure('hours', '7.25')).toEqual({ value: 7.25 });
  });
});

describe('progress', () => {
  it('counts towards the target when higher is better', () => {
    expect(progressPercent(summary(30, 120), 'increase')).toBe(25);
    expect(progressPercent(summary(150, 120), 'increase')).toBe(125);
  });

  it('counts from the baseline down to the target when lower is better', () => {
    expect(progressPercent(summary(60, 20, 100), 'decrease')).toBe(50);
    expect(progressPercent(summary(120, 20, 100), 'decrease')).toBe(0);
  });

  it('gives no figure without a result, a target, or a distance to cover', () => {
    expect(progressPercent(summary(null, 10), 'increase')).toBeNull();
    expect(progressPercent(summary(5, null), 'increase')).toBeNull();
    expect(progressPercent(summary(5, 0), 'increase')).toBeNull();
    expect(progressPercent(summary(5, 10, null), 'decrease')).toBeNull();
    expect(progressPercent(summary(5, 10, 10), 'decrease')).toBeNull();
  });
});

describe('periods', () => {
  it('writes dates in full', () => {
    expect(formatDay('2026-04-01')).toBe('1 April 2026');
    expect(formatPeriod('2026-04-01', '2027-03-31')).toBe('1 April 2026 to 31 March 2027');
    expect(formatDay('2026-04-01T23:30:00.000Z')).toBe('1 April 2026');
    expect(formatDay('soon')).toBe('soon');
  });
});
