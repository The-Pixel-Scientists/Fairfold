// SPDX-License-Identifier: AGPL-3.0-or-later

import { MIN_CONTRAST, messages } from '@pixel-scientists/domain/platform';
import { describe, expect, it } from 'vitest';

import { colourProblem, isHexColour, lowestContrast, showRatio } from './colour.ts';

describe('isHexColour', () => {
  it('accepts a six-digit hex code in either case, and nothing else', () => {
    expect(isHexColour('#1f4bb8')).toBe(true);
    expect(isHexColour('#1F4BB8')).toBe(true);
    for (const value of ['', '#1f4', '1f4bb8', '#1f4bb8 ', '#1f4bbg', '#1f4bb80']) {
      expect(isHexColour(value)).toBe(false);
    }
  });
});

describe('showRatio', () => {
  it('rounds down, so a colour under the minimum never reads as the minimum', () => {
    expect(showRatio(4.46)).toBe('4.4');
    expect(showRatio(7.0)).toBe('7.0');
    expect(showRatio(2.99)).toBe('2.9');
  });
});

describe('lowestContrast', () => {
  it('is the figure that decides: at least the minimum for a colour that passes, under it for one that fails', () => {
    expect(lowestContrast('#1f4bb8')).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(lowestContrast('#ffee00')).toBeLessThan(MIN_CONTRAST);
  });
});

describe('colourProblem', () => {
  it('has nothing to say about a colour that passes', () => {
    expect(colourProblem('#1f4bb8')).toBeNull();
    expect(colourProblem('#1F4BB8')).toBeNull();
  });

  it('says nothing about a colour that is still being typed', () => {
    expect(colourProblem('')).toBeNull();
    expect(colourProblem('#ffee')).toBeNull();
  });

  it('gives the catalogue message, the contrast found and a colour that passes', () => {
    const problem = colourProblem('#ffee00');

    expect(problem?.suggestion).toMatch(/^#[0-9a-f]{6}$/);
    expect(problem?.message).toBe(messages.brandColourContrast(problem?.suggestion ?? ''));
    expect(problem?.contrast).toMatch(/^Contrast found: \d\.\d to 1\. The minimum is 4\.5 to 1\.$/);
    expect(colourProblem(problem?.suggestion ?? '')).toBeNull();
  });

  it("shows the API's words for a colour the check here passes, with the colour they suggest", () => {
    const refusal = messages.brandColourContrast('#123456');

    expect(colourProblem('#1f4bb8', refusal)).toMatchObject({
      message: refusal,
      suggestion: '#123456',
    });
  });

  it("prefers the check here to the API's words when the colour fails it", () => {
    expect(colourProblem('#ffee00', 'Something else.')?.message).toMatch(/too light/);
  });
});
