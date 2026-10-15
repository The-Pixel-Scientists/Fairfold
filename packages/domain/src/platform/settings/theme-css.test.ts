// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkTheme, contrastRatio, defaultTheme, presets, type Preset } from '../theme.ts';
import {
  checkTokens,
  defaultTokens,
  fonts,
  tokenDefinitions,
  type TokenSet,
} from '../theme-tokens.ts';
import {
  COMFORTABLE_SELECTOR,
  DARK_SCHEME_SELECTOR,
  presetTokens,
  themeCss,
  themeProperties,
  tokensFromPreset,
} from './theme-css.ts';

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

/** Brand colours that pass checkTheme(), from a sweep of the RGB cube. */
function passingColours(): string[] {
  const steps = [0x00, 0x33, 0x66, 0x99, 0xcc, 0xff];
  const colours = steps.flatMap((red) =>
    steps.flatMap((green) =>
      steps.map(
        (blue) => `#${[red, green, blue].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
      ),
    ),
  );
  return colours.filter((colour) => checkTheme({ brandColour: colour }).problems.length === 0);
}

describe('tokensFromPreset', () => {
  it('gives the defaults for the standard preset in ink', () => {
    expect(tokensFromPreset(defaultTheme.brandColour, 'standard')).toEqual(defaultTokens);
  });

  it('takes the preset’s radii and surfaces and the derived accent shades', () => {
    const tokens = tokensFromPreset('#1F4BB8', 'square');
    expect(tokens.radii).toEqual({ radiusSm: 0, radiusMd: 0, radiusLg: 0 });
    expect(tokens.light.colorAccent).toBe('#1f4bb8');
    expect(tokens.light.colorCanvas).toBe(presetTokens.square.canvas);
    expect(tokens.dark.colorSunken).toBe(presetTokens.square.darkSunken);
    expect(tokens.type).toEqual(defaultTokens.type);
  });

  it('gives every preset look tokens that pass checkTokens(), for every passing brand colour', () => {
    const colours = passingColours();
    expect(colours.length).toBeGreaterThan(50);
    for (const colour of [defaultTheme.brandColour, ...colours]) {
      for (const preset of presets) {
        expect(checkTokens(tokensFromPreset(colour, preset)), `${colour} ${preset}`).toEqual([]);
      }
    }
  });

  it('refuses a brand colour that fails the theme schema', () => {
    expect(() => tokensFromPreset('#ffffff', 'standard')).toThrow(TypeError);
    expect(() => tokensFromPreset('#1f4bb8', 'bold' as Preset)).toThrow(TypeError);
  });
});

describe('themeCss with tokens', () => {
  const tokens: TokenSet = {
    ...defaultTokens,
    light: { ...defaultTokens.light, colorAccent: '#0b5394' },
    radii: { radiusSm: 0, radiusMd: 0.125, radiusLg: 1.5 },
    font: 'system',
  };
  const stacks: string[] = Object.values(fonts).map((font) => font.stack);
  const selectors = [':root', DARK_SCHEME_SELECTOR, COMFORTABLE_SELECTOR];

  /** Every line: a known selector, a known custom property with a formatted value, a brace or a blank. */
  function expectStrict(css: string) {
    const properties = new Set(tokenDefinitions.map((token) => token.property));
    for (const line of css.split('\n')) {
      if (line === '' || line === '}') continue;
      if (line.endsWith(' {')) {
        expect(selectors).toContain(line.slice(0, -2));
        continue;
      }
      const match = /^ {2}(--[a-z0-9-]+): (.+);$/.exec(line);
      expect(match, line).not.toBeNull();
      expect(properties).toContain(match?.[1]);
      const value = match?.[2] ?? '';
      expect(
        /^(?:#[0-9a-f]{6}|\d+(?:\.\d{1,3})?rem|0)$/.test(value) || stacks.includes(value),
        line,
      ).toBe(true);
    }
  }

  it('writes the light, dark and comfortable blocks from the parsed values', () => {
    const css = themeCss({ tokens });
    const lines = css.split('\n');
    expect(lines.filter((line) => line.endsWith(' {'))).toEqual(selectors.map((s) => `${s} {`));
    expect(lines).toContain('  --color-accent: #0b5394;');
    expect(lines).toContain('  --radius-sm: 0;');
    expect(lines).toContain('  --radius-lg: 1.5rem;');
    expect(lines).toContain(`  --font-sans: ${fonts.system.stack};`);
    expect(lines).toContain('  --text-4xl--line-height: 2.625rem;');
    expect(lines).toContain('  --density-field-gap: 0.375rem;');
    const { light, dark, comfortable } = themeProperties({ tokens });
    expect(light).toHaveLength(22 + 3 + 1);
    expect(dark).toHaveLength(22);
    expect(comfortable).toHaveLength(16 + 7);
    expect(comfortable.every(([name]) => /^--(?:text|density)-/.test(name))).toBe(true);
    expectStrict(css);
  });

  it('writes only properties tokens.css defines, in the same blocks', () => {
    const { light, dark, comfortable } = themeProperties({ tokens: defaultTokens });
    for (const [name] of [...light, ...comfortable]) expect(lightTokens).toContain(`${name}:`);
    for (const [name] of dark) expect(darkTokens).toContain(`${name}:`);
  });

  it('lets nothing a funder typed reach the output', () => {
    const hostile: [path: string, value: unknown][] = [
      ['light.colorInk', '#17181b; } body { color: red'],
      ['light.colorInk', '#17181b}'],
      ['light.colorInk', '#17181b/*'],
      ['light.colorInk', 'url(https://evil.example/x)'],
      ['light.colorInk', '#17181\\62'],
      ['light.colorInk', '@import "x"'],
      ['light.colorInk', '\\0023 17181b'],
      ['light.colorInk', '#17181b !important'],
      ['radii.radiusSm', '0.25rem; }'],
      ['radii.radiusSm', '0.25rem'],
      ['radii.radiusSm', 1e21],
      ['font', "atkinson; } @import url('x')"],
      ['font', 'constructor'],
      ['type.textXs', { toString: () => '0.75rem; }' }],
    ];
    for (const [path, value] of hostile) {
      const [group = '', key] = path.split('.');
      const copy = JSON.parse(JSON.stringify(defaultTokens)) as Record<string, unknown>;
      if (key === undefined) copy[group] = value;
      else copy[group] = { ...(copy[group] as object), [key]: value };
      expect(() => themeCss({ tokens: copy as TokenSet }), `${path} ${String(value)}`).toThrow(
        TypeError,
      );
    }
    const extra = [
      { ...defaultTokens, css: '} body {' },
      { ...defaultTokens, light: { ...defaultTokens.light, 'color-ink; }': '#000000' } },
      { ...defaultTokens, preset: 'standard', brandColour: '#1f4bb8' },
      null,
      'tokens',
    ];
    for (const value of extra) {
      expect(() => themeCss({ tokens: value as TokenSet })).toThrow(TypeError);
    }
    for (const preset of presets) {
      expectStrict(themeCss({ tokens: tokensFromPreset('#7a2e8c', preset) }));
    }
  });

  it('refuses tokens that fail a contrast pair', () => {
    const failing = { ...defaultTokens, dark: { ...defaultTokens.dark, colorMuted: '#555555' } };
    expect(() => themeCss({ tokens: failing })).toThrow(TypeError);
  });
});
