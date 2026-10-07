// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { contrastRatio, defaultTheme, presets, type Preset } from '../theme.ts';
import { DARK_SCHEME_SELECTOR, presetTokens, themeCss } from './theme-css.ts';

// Tests run on Node.js, but this package has no Node.js types: just enough to read a file.
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, as: 'utf8'): string } };
};
const { dirname } = import.meta as unknown as { dirname: string };
const tokensCss = process
  .getBuiltinModule('node:fs')
  .readFileSync(`${dirname}/../../../../ui/src/tokens.css`, 'utf8');
const lightTokens = tokensCss.slice(0, tokensCss.indexOf(DARK_SCHEME_SELECTOR));
const darkTokens = tokensCss.slice(tokensCss.indexOf(DARK_SCHEME_SELECTOR));

/** A custom property set to a hex colour, a rem length or zero, and nothing else. */
const DECLARATION = /^ {2}--[a-z]+(?:-[a-z]+)*: (?:#[0-9a-f]{6}|\d+(?:\.\d+)?rem|0);$/;

/** The declarations in each of the two blocks, after checking that nothing else is there. */
function blocks(css: string): { light: string[]; dark: string[] } {
  const lines = css.split('\n');
  const darkStart = lines.indexOf(`${DARK_SCHEME_SELECTOR} {`);
  expect(lines[0]).toBe(':root {');
  expect(lines.slice(darkStart - 2, darkStart)).toEqual(['}', '']);
  expect(lines.slice(-2)).toEqual(['}', '']);
  return { light: lines.slice(1, darkStart - 2), dark: lines.slice(darkStart + 1, -2) };
}

function declarations(css: string): string[] {
  const { light, dark } = blocks(css);
  return [...light, ...dark];
}

describe('themeCss', () => {
  it('sets the accent shades, surfaces and radii for each colour scheme', () => {
    expect(themeCss({ brandColour: '#1F4BB8', preset: 'rounded' })).toBe(
      [
        ':root {',
        '  --color-accent: #1f4bb8;',
        '  --color-accent-hover: #193c93;',
        '  --color-accent-soft: #e9edf8;',
        '  --color-canvas: #f8f7f4;',
        '  --color-sunken: #f1f0eb;',
        '  --radius-sm: 0.5rem;',
        '  --radius-md: 0.75rem;',
        '  --radius-lg: 1rem;',
        '}',
        '',
        ":root[data-scheme='dark'] {",
        '  --color-accent: #aac4f9;',
        '  --color-accent-hover: #ccdbf9;',
        '  --color-accent-soft: #162545;',
        '  --color-canvas: #12110e;',
        '  --color-sunken: #23211d;',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('turns ink into the dark scheme’s paper white', () => {
    expect(blocks(themeCss(defaultTheme)).dark.slice(0, 3)).toEqual([
      '  --color-accent: #ececea;',
      '  --color-accent-hover: #ffffff;',
      '  --color-accent-soft: #2a2c30;',
    ]);
  });

  it('uses only custom properties that tokens.css defines for that scheme', () => {
    for (const preset of presets) {
      const { light, dark } = blocks(themeCss({ ...defaultTheme, preset }));
      for (const [lines, tokens] of [
        [light, lightTokens],
        [dark, darkTokens],
      ] as const) {
        for (const line of lines) {
          const name = line.trim().split(':')[0] ?? '';
          expect(tokens, name).toContain(`${name}:`);
        }
      }
    }
  });

  it('refuses hostile, malformed or failing tokens, and lets only hex values and fixed names through', () => {
    const hostile = [
      '#1f4bb8; } body { background: url(https://evil.example/x) }',
      '#1f4bb8\n}',
      '#1f4bb8 !important',
      '</style><script>alert(1)</script>',
      'red',
      'expression(alert(1))',
      '#1f4bb',
      '#1f4bb8 ',
      ' #1f4bb8',
      '#ffffff',
      '#ffff00',
      '',
    ];
    for (const brandColour of hostile) {
      expect(() => themeCss({ brandColour, preset: 'standard' }), brandColour).toThrow(TypeError);
    }
    for (const preset of ['bold', 'standard; }', '__proto__', 'toString']) {
      expect(() => themeCss({ brandColour: '#1f4bb8', preset: preset as Preset })).toThrow(
        TypeError,
      );
    }
    for (const brandColour of ['#000000', '#1F4BB8', '#7a2e8c']) {
      for (const preset of presets) {
        for (const line of declarations(themeCss({ brandColour, preset }))) {
          expect(line).toMatch(DECLARATION);
        }
      }
    }
  });

  it('ignores keys other than the brand colour and preset', () => {
    const extra = { ...defaultTheme, logoType: 'image/png', name: '} body {' } as const;
    expect(themeCss(extra)).toBe(themeCss(defaultTheme));
  });
});

describe('presetTokens', () => {
  it('keeps each light surface at least as light as the standard one, and each dark one at least as dark', () => {
    const standard = presetTokens.standard;
    const lightness = (colour: string) => contrastRatio(colour, '#000000');
    for (const preset of presets) {
      const { canvas, sunken, darkCanvas, darkSunken } = presetTokens[preset];
      expect(lightness(canvas)).toBeGreaterThanOrEqual(lightness(standard.canvas));
      expect(lightness(sunken)).toBeGreaterThanOrEqual(lightness(standard.sunken));
      expect(lightness(darkCanvas)).toBeLessThanOrEqual(lightness(standard.darkCanvas));
      expect(lightness(darkSunken)).toBeLessThanOrEqual(lightness(standard.darkSunken));
    }
  });

  it('match tokens.css for the standard preset in both schemes, accent included', () => {
    const { light, dark } = blocks(themeCss(defaultTheme));
    for (const line of light) expect(lightTokens).toContain(line.trim());
    for (const line of dark) expect(darkTokens).toContain(line.trim());
  });
});
