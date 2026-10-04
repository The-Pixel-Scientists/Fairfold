// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { contrastRatio, defaultTheme, presets, type Preset } from '../theme.ts';
import { presetTokens, themeCss } from './theme-css.ts';

// Tests run on Node.js, but this package has no Node.js types: just enough to read a file.
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, as: 'utf8'): string } };
};
const { dirname } = import.meta as unknown as { dirname: string };
const tokensCss = process
  .getBuiltinModule('node:fs')
  .readFileSync(`${dirname}/../../../../ui/src/tokens.css`, 'utf8');

/** A custom property set to a hex colour, a rem length or zero, and nothing else. */
const DECLARATION = /^ {2}--[a-z]+(?:-[a-z]+)*: (?:#[0-9a-f]{6}|\d+(?:\.\d+)?rem|0);$/;

function declarations(css: string): string[] {
  const lines = css.split('\n');
  expect(lines[0]).toBe(':root {');
  expect(lines.slice(-2)).toEqual(['}', '']);
  return lines.slice(1, -2);
}

describe('themeCss', () => {
  it('sets the accent shades, surfaces and radii as custom properties', () => {
    expect(themeCss({ brandColour: '#1F4BB8', preset: 'rounded' })).toBe(
      [
        ':root {',
        '  --color-accent: #1f4bb8;',
        '  --color-accent-hover: #193c93;',
        '  --color-accent-soft: #e9edf8;',
        '  --color-canvas: #f8f7f4;',
        '  --color-sunken: #f0efea;',
        '  --radius-sm: 0.5rem;',
        '  --radius-md: 0.75rem;',
        '  --radius-lg: 1rem;',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('uses only custom properties that tokens.css defines', () => {
    for (const preset of presets) {
      for (const line of declarations(themeCss({ ...defaultTheme, preset }))) {
        const name = line.trim().split(':')[0] ?? '';
        expect(tokensCss, name).toContain(`${name}:`);
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
  it('keeps every surface at least as light as the standard one, so contrast still holds', () => {
    const standard = presetTokens.standard;
    for (const preset of presets) {
      const { canvas, sunken } = presetTokens[preset];
      expect(contrastRatio(canvas, '#000000')).toBeGreaterThanOrEqual(
        contrastRatio(standard.canvas, '#000000'),
      );
      expect(contrastRatio(sunken, '#000000')).toBeGreaterThanOrEqual(
        contrastRatio(standard.sunken, '#000000'),
      );
    }
  });

  it('match tokens.css for the standard preset', () => {
    const css = themeCss(defaultTheme);
    for (const line of declarations(css)) {
      if (line.includes('--color-accent')) continue;
      expect(tokensCss).toContain(line.trim());
    }
  });
});
