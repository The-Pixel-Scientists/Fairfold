// SPDX-License-Identifier: AGPL-3.0-or-later

import { messageForIssue } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { MAX_FIGURE, figureProblem, figureSchema } from './figures.ts';
import { indicatorUnits } from './frameworks.ts';
import { impactMessages } from './messages.ts';

describe('a figure', () => {
  it('is never negative, never over the cap and has at most 2 decimal places', () => {
    for (const good of [0, 1, 12.5, 0.07, 99.99, 1234567.89, MAX_FIGURE]) {
      expect(figureSchema.safeParse(good).success, String(good)).toBe(true);
    }
    for (const bad of [-1, -0.01, MAX_FIGURE + 1, 1.234, 0.001, Number.NaN, Infinity, '12', null]) {
      expect(figureSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
    const [issue] = figureSchema.safeParse(1.234).error?.issues ?? [];
    expect(issue && messageForIssue(issue)).toBe(impactMessages.decimalPlaces);
  });

  it('fits its unit: whole counts, people and pence, and a percentage up to 100', () => {
    for (const unit of ['count', 'people', 'money'] as const) {
      expect(figureProblem(unit, 12)).toBeNull();
      expect(figureProblem(unit, 12.5)).toBe(impactMessages.wholeNumber);
    }
    expect(figureProblem('percentage', 100)).toBeNull();
    expect(figureProblem('percentage', 62.25)).toBeNull();
    expect(figureProblem('percentage', 100.01)).toBe(impactMessages.percentage);
    expect(figureProblem('hours', 7.25)).toBeNull();
    expect(figureProblem('number', 1500.5)).toBeNull();
    for (const unit of indicatorUnits) {
      expect(figureProblem(unit, -1)).toBe(impactMessages.decimalPlaces);
      expect(figureProblem(unit, 0.001)).toBe(impactMessages.decimalPlaces);
      expect(figureProblem(unit, 0)).toBeNull();
    }
  });
});
