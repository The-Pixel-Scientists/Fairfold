// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messages } from './messages.ts';
import {
  brandColourSchema,
  checkTheme,
  contrastRatio,
  defaultTheme,
  deriveDarkShades,
  deriveShades,
  MIN_CONTRAST,
  themeSchema,
} from './theme.ts';

describe('contrastRatio', () => {
  it('gives the WCAG ratios for known pairs', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#1f4bb8', '#1f4bb8')).toBe(1);
  });

  it('does not depend on the order or the case of the colours', () => {
    expect(contrastRatio('#FFFFFF', '#767676')).toBe(contrastRatio('#767676', '#ffffff'));
  });

  it('refuses something that is not a hex colour', () => {
    expect(() => contrastRatio('red', '#ffffff')).toThrow();
  });
});

describe('checkTheme', () => {
  it('passes the default theme, whose shades all reach AA', () => {
    const check = checkTheme(defaultTheme);
    expect(check.problems).toEqual([]);
    expect(check.suggestion).toBeNull();
    expect(contrastRatio(check.shades.hover, '#ffffff')).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('checks every surface, not only white', () => {
    // 4.54:1 on white, but 3.94:1 on the sunken surface (#efefec).
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(MIN_CONTRAST);
    expect(checkTheme({ brandColour: '#767676' }).problems).toHaveLength(1);
    expect(contrastRatio('#6c6c6c', '#efefec')).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(checkTheme({ brandColour: '#6c6c6c' }).problems).toEqual([]);
    expect(contrastRatio('#6d6d6d', '#efefec')).toBeLessThan(MIN_CONTRAST);
    expect(checkTheme({ brandColour: '#6d6d6d' }).problems).toHaveLength(1);
  });

  it('checks brand-coloured text on its own tint', () => {
    const { brand, tint } = deriveShades(defaultTheme.brandColour);
    expect(contrastRatio(brand, tint)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('suggests the nearest darker shade that passes', () => {
    const check = checkTheme({ brandColour: '#ffcc00' });
    expect(check.suggestion).toMatch(/^#[0-9a-f]{6}$/);
    const suggestion = check.suggestion ?? '';
    expect(checkTheme({ brandColour: suggestion }).problems).toEqual([]);
    expect(contrastRatio(suggestion, '#efefec')).toBeLessThan(MIN_CONTRAST + 0.5);
    expect(check.problems).toEqual([
      { field: 'brandColour', message: messages.brandColourContrast(suggestion) },
    ]);
  });

  it('suggests a passing colour even for white', () => {
    const suggestion = checkTheme({ brandColour: '#ffffff' }).suggestion ?? '';
    expect(checkTheme({ brandColour: suggestion }).problems).toEqual([]);
  });

  it('derives a darker hover shade and a light tint', () => {
    const { brand, hover, tint } = deriveShades('#1F4BB8');
    expect(brand).toBe('#1f4bb8');
    expect(contrastRatio(hover, '#ffffff')).toBeGreaterThan(contrastRatio(brand, '#ffffff'));
    expect(contrastRatio('#17181b', tint)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});

describe('deriveShades', () => {
  it('lightens the hover shade of a colour too dark to show a darker one', () => {
    const { brand, hover } = deriveShades(defaultTheme.brandColour);
    expect(hover).toBe('#36383c');
    expect(contrastRatio(hover, '#000000')).toBeGreaterThan(contrastRatio(brand, '#000000'));
    expect(contrastRatio(hover, '#ffffff')).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});

describe('deriveDarkShades', () => {
  /** Every pair the dark scheme draws with the shades, from packages/ui/src/tokens.css. */
  function darkPairs({ brand, hover, tint }: { brand: string; hover: string; tint: string }) {
    return [
      ...['#111214', '#18191c', '#212226', tint].map((surface) => [brand, surface] as const),
      [brand, '#141518'],
      [hover, '#141518'],
      ['#ececea', tint],
      ['#a3a6ac', tint],
    ] as const;
  }

  it('turns ink, black and greys into the dark scheme’s own paper white', () => {
    for (const colour of [defaultTheme.brandColour, '#000000', '#595959']) {
      expect(deriveDarkShades(colour)).toEqual({
        brand: '#ececea',
        hover: '#ffffff',
        tint: '#2a2c30',
      });
    }
  });

  it('keeps a colour’s hue at a lighter shade, with a dark tint of it', () => {
    expect(deriveDarkShades('#0B5D3B')).toEqual({
      brand: '#8ed7ae',
      hover: '#a5eec5',
      tint: '#182b21',
    });
  });

  it('reaches AA in the dark scheme for every colour that passes the light check', () => {
    const steps = [0x00, 0x24, 0x49, 0x6d, 0x92, 0xb6, 0xdb, 0xff];
    let checked = 0;
    for (const red of steps) {
      for (const green of steps) {
        for (const blue of steps) {
          const colour = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
          if (checkTheme({ brandColour: colour }).problems.length > 0) continue;
          checked += 1;
          for (const [a, b] of darkPairs(deriveDarkShades(colour))) {
            expect(contrastRatio(a, b), `${colour}: ${a} on ${b}`).toBeGreaterThanOrEqual(
              MIN_CONTRAST,
            );
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('brandColourSchema', () => {
  it('stores the colour in lower case', () => {
    expect(brandColourSchema.parse('#1F4BB8')).toBe('#1f4bb8');
  });

  it('refuses anything that is not #rrggbb, with the format message', () => {
    for (const value of ['1f4bb8', '#fff', '#1f4bb8ff', '#1f4bbg', 'blue', '']) {
      const result = brandColourSchema.safeParse(value);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        messages.brandColourFormat,
      ]);
    }
  });

  it('refuses a colour that fails contrast, offering the suggestion', () => {
    const result = brandColourSchema.safeParse('#FFCC00');
    const suggestion = checkTheme({ brandColour: '#ffcc00' }).suggestion ?? '';
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      messages.brandColourContrast(suggestion),
    ]);
  });
});

describe('themeSchema', () => {
  it('takes the default theme and refuses unknown keys or presets', () => {
    expect(themeSchema.parse(defaultTheme)).toEqual(defaultTheme);
    expect(themeSchema.safeParse({ ...defaultTheme, css: 'body{}' }).success).toBe(false);
    expect(themeSchema.safeParse({ ...defaultTheme, preset: 'neon' }).success).toBe(false);
    expect(themeSchema.safeParse({ ...defaultTheme, logoType: 'image/svg+xml' }).success).toBe(
      false,
    );
  });
});
