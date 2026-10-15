// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { messages } from './messages.ts';
import {
  checkTokens,
  contrastPairs,
  defaultTokens,
  fonts,
  MIN_INTERFACE_CONTRAST,
  tokenDefinitions,
  tokenMessages,
  tokenPaths,
  tokenSetSchema,
  tokenValue,
  type TokenSet,
} from './theme-tokens.ts';
import { MIN_CONTRAST } from './theme.ts';

// Tests run on Node.js, but this package has no Node.js types: just enough to read a file.
const { process } = globalThis as unknown as {
  process: { getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, as: 'utf8'): string } };
};
const { dirname } = import.meta as unknown as { dirname: string };
const tokensCss = process
  .getBuiltinModule('node:fs')
  .readFileSync(`${dirname}/../../../ui/src/tokens.css`, 'utf8');
const DARK = ":root[data-scheme='dark']";
const lightCss = tokensCss.slice(0, tokensCss.indexOf(DARK));
const darkCss = tokensCss.slice(tokensCss.indexOf(DARK));

/** The first value tokens.css gives a custom property in a stretch of the file. */
function cssValue(css: string, property: string): string | undefined {
  const at = css.indexOf(`${property}:`);
  if (at === -1) return undefined;
  const end = css.indexOf(';', at);
  return css
    .slice(at + property.length + 1, end)
    .replace(/\s+/g, ' ')
    .trim();
}

/** A copy of the defaults with one token changed. */
function withToken(path: string, value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(defaultTokens)) as Record<string, Record<string, unknown>>;
  const [group = '', key] = path.split('.');
  if (key === undefined) (copy as Record<string, unknown>)[group] = value;
  else (copy[group] as Record<string, unknown>)[key] = value;
  return copy;
}

/** Issues at a path, as messages. */
function issuesAt(value: unknown, path: string): string[] {
  const result = tokenSetSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path.join('.') === path)
    .map((issue) => issue.message);
}

describe('defaultTokens', () => {
  it('pass the schema unchanged', () => {
    expect(tokenSetSchema.parse(defaultTokens)).toEqual(defaultTokens);
  });

  it('match tokens.css for every token, in its block', () => {
    for (const token of tokenDefinitions) {
      const css = token.block === 'dark' ? darkCss : lightCss;
      const value = tokenValue(defaultTokens, token.path);
      const expected =
        token.kind === 'font'
          ? fonts[value as keyof typeof fonts].stack
          : typeof value === 'number'
            ? value === 0
              ? '0'
              : `${value}rem`
            : value;
      expect(cssValue(css, token.property), token.path).toBe(expected);
    }
  });

  it('cover every colour tokens.css defines, in both schemes', () => {
    const declared = new Set(
      [...lightCss.matchAll(/(--color-[a-z-]+):\s*#/g)].map((match) => match[1]),
    );
    const colours = tokenDefinitions.filter((token) => token.kind === 'colour');
    expect(new Set(colours.filter((t) => t.block === 'root').map((t) => t.property))).toEqual(
      declared,
    );
    expect(new Set(colours.filter((t) => t.block === 'dark').map((t) => t.property))).toEqual(
      declared,
    );
  });

  it('pass every contrast pair', () => {
    expect(checkTokens(defaultTokens)).toEqual([]);
  });
});

describe('tokenDefinitions', () => {
  it('map each token to one custom property, named after it', () => {
    const camel = (property: string) =>
      property.slice(2).replace(/-+([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
    for (const token of tokenDefinitions) {
      if (token.kind !== 'font') expect(token.path.split('.')[1]).toBe(camel(token.property));
    }
    expect(new Set(tokenPaths).size).toBe(tokenPaths.length);
    for (const block of ['root', 'dark', 'comfortable']) {
      const properties = tokenDefinitions.filter((t) => t.block === block).map((t) => t.property);
      expect(new Set(properties).size, block).toBe(properties.length);
    }
    expect(tokenPaths).toHaveLength(22 * 2 + 3 + 1 + 16 + 7);
  });

  it('say what each token does and the rule it keeps, as sentences', () => {
    for (const token of tokenDefinitions) {
      expect(token.about, token.path).toMatch(/^[A-Z].*\.$/);
      expect(token.about, token.path).not.toContain('*/');
    }
    const about = (path: string) => tokenDefinitions.find((t) => t.path === path)?.about;
    expect(about('light.colorInk')).toContain('at least 4.5:1 on canvas, surface, sunken');
    expect(about('dark.colorEdge')).toContain('at least 3:1 on canvas, surface, sunken');
    expect(about('light.colorDivider')).toContain('no contrast rule');
    expect(about('radii.radiusMd')).toBe(
      'Buttons and fields. From 0 to 1.5rem. At least --radius-sm.',
    );
  });
});

describe('fonts', () => {
  it('offer Atkinson Hyperlegible Next and the system font, each with a fixed stack', () => {
    expect(Object.keys(fonts)).toEqual(['atkinson', 'system']);
    for (const font of Object.values(fonts)) {
      expect(font.label).not.toBe('');
      expect(font.stack).toMatch(/^[A-Za-z0-9 ',-]+, sans-serif$/);
    }
  });
});

describe('tokenSetSchema', () => {
  it('stores colours in lower case', () => {
    const parsed = tokenSetSchema.parse(withToken('light.colorFocus', '#2457D6'));
    expect(parsed.light.colorFocus).toBe('#2457d6');
  });

  it('refuses unknown or missing keys at every level', () => {
    const extra = [
      { ...defaultTokens, logo: null },
      { ...defaultTokens, light: { ...defaultTokens.light, colorBrand: '#000000' } },
      { ...defaultTokens, radii: { ...defaultTokens.radii, radiusXl: 1 } },
      { ...defaultTokens, type: { ...defaultTokens.type, '--text-xs': 0.75 } },
      {
        ...defaultTokens,
        density: { ...defaultTokens.density, ...(JSON.parse('{"__proto__": 1}') as object) },
      },
    ];
    const missing = [withToken('font', undefined), withToken('dark.colorInk', undefined)];
    for (const value of [...extra, ...missing]) {
      expect(tokenSetSchema.safeParse(value).success).toBe(false);
    }
  });

  it('takes colours only as #rrggbb', () => {
    for (const colour of ['red', '#fff', '#2457d6ff', ' #2457d6', '#2457d6;', 'url(x)', 1]) {
      expect(issuesAt(withToken('light.colorFocus', colour), 'light.colorFocus')).not.toEqual([]);
    }
    expect(issuesAt(withToken('light.colorFocus', 'red'), 'light.colorFocus')).toEqual([
      messages.brandColourFormat,
    ]);
  });

  it('takes lengths only as numbers of rem with up to three decimal places', () => {
    for (const value of ['0.25rem', '0.25', 0.2505, -0.25, Number.NaN, Infinity, null]) {
      expect(issuesAt(withToken('radii.radiusSm', value), 'radii.radiusSm')).not.toEqual([]);
    }
    expect(tokenSetSchema.safeParse(withToken('radii.radiusSm', 0.125)).success).toBe(true);
    expect(tokenSetSchema.safeParse(withToken('radii.radiusSm', 0)).success).toBe(true);
  });

  it('takes the font only from the list', () => {
    for (const font of ['Comic Sans', 'toString', '__proto__', 'ATKINSON', '']) {
      expect(tokenSetSchema.safeParse({ ...defaultTokens, font }).success, font).toBe(false);
    }
    expect(tokenSetSchema.safeParse({ ...defaultTokens, font: 'system' }).success).toBe(true);
  });

  it('keeps each length within its bounds', () => {
    const bounds: [path: string, min: number, max: number][] = [
      ['radii.radiusSm', 0, 1.5],
      ['type.textXs', 0.75, 3],
      ['type.textBase', 1, 3],
      ['type.text4xl', 0.75, 3],
      ['type.text4xlLineHeight', 0.75, 6],
      ['density.densityControlHeight', 2.5, 3.5],
      ['density.densityControlPx', 0.5, 1.5],
      ['density.densityBodySize', 1, 1.25],
      ['density.densityBodyLeading', 1.4, 2.5],
      ['density.densityGutter', 0.25, 3],
      ['density.densityStack', 0.25, 3],
      ['density.densityFieldGap', 0.25, 3],
    ];
    for (const [path, min, max] of bounds) {
      const message = tokenMessages.length(min, max);
      for (const value of [min, max]) {
        expect(issuesAt(withToken(path, value), path), `${path} ${value}`).not.toContain(message);
      }
      for (const value of [min - 0.001, max + 0.001]) {
        expect(issuesAt(withToken(path, value), path), `${path} ${value}`).toContain(message);
      }
    }
    expect(tokenMessages.length(0.75, 3)).toBe(
      'Enter a length from 0.75rem to 3rem, like 1.125rem, with up to three decimal places.',
    );
  });

  it('keeps the radii and the type sizes in order', () => {
    expect(issuesAt(withToken('radii.radiusMd', 0.2), 'radii.radiusMd')).toEqual([
      'Make --radius-md at least as large as --radius-sm.',
    ]);
    expect(issuesAt(withToken('radii.radiusLg', 0.3), 'radii.radiusLg')).toEqual([
      'Make --radius-lg at least as large as --radius-md.',
    ]);
    expect(issuesAt(withToken('type.textLg', 0.99), 'type.textLg')).toContain(
      'Make --text-lg at least as large as --text-base.',
    );
    const equal = withToken('radii.radiusMd', 0.25);
    expect(tokenSetSchema.safeParse(equal).success).toBe(true);
  });

  it('keeps line heights from their minimum to 2 times their size', () => {
    const cases: [path: string, value: number, passes: boolean][] = [
      ['type.textXsLineHeight', 0.825, true],
      ['type.textXsLineHeight', 0.82, false],
      ['type.textXsLineHeight', 1.5, true],
      ['type.textXsLineHeight', 1.501, false],
      ['type.textSmLineHeight', 1.225, true],
      ['type.textSmLineHeight', 1.2, false],
      ['type.textBaseLineHeight', 1.39, false],
      ['type.text4xlLineHeight', 2.475, true],
      ['density.densityBodyLeading', 1.4, true],
      ['density.densityBodyLeading', 2.001, false],
    ];
    for (const [path, value, passes] of cases) {
      expect(tokenSetSchema.safeParse(withToken(path, value)).success, `${path} ${value}`).toBe(
        passes,
      );
    }
    expect(issuesAt(withToken('type.textSmLineHeight', 1.2), 'type.textSmLineHeight')).toEqual([
      'Make --text-sm--line-height between 1.4 and 2 times --text-sm.',
    ]);
  });
});

describe('contrastPairs', () => {
  it('hold the text pairs at 4.5:1 and the interface pairs at 3:1, as tokens.css is checked', () => {
    const text = contrastPairs.filter((pair) => pair.minimum === MIN_CONTRAST);
    const ui = contrastPairs.filter((pair) => pair.minimum === MIN_INTERFACE_CONTRAST);
    expect(text).toHaveLength(30);
    expect(ui).toHaveLength(17);
    expect(text.length + ui.length).toBe(contrastPairs.length);
    expect(text).toContainEqual({
      foreground: 'colorOnAccent',
      background: 'colorAccentHover',
      minimum: 4.5,
    });
    expect(ui).toContainEqual({
      foreground: 'colorFocus',
      background: 'colorInfoSoft',
      minimum: 3,
    });
  });

  it('check every colour but the divider', () => {
    const checked = new Set(contrastPairs.flatMap((pair) => [pair.foreground, pair.background]));
    const unchecked = Object.keys(defaultTokens.light).filter((key) => !checked.has(key as never));
    expect(unchecked).toEqual(['colorDivider']);
  });
});

describe('checkTokens', () => {
  it('names the scheme, the pair, the ratio found and the ratio needed', () => {
    expect(tokenMessages.contrast('dark', 'colorInk', 'colorAccentSoft', 3.96, 4.5)).toBe(
      'In the dark scheme, ink on accent soft is 3.9:1. It needs at least 4.5:1.',
    );
  });

  it('returns every failing pair, in both schemes', () => {
    const tokens: TokenSet = {
      ...defaultTokens,
      light: { ...defaultTokens.light, colorMuted: '#999999' },
      dark: { ...defaultTokens.dark, colorEdge: '#303030' },
    };
    const problems = checkTokens(tokens);
    expect(problems.map((problem) => problem.field)).toEqual([
      ...Array<string>(4).fill('light.colorMuted'),
      ...Array<string>(3).fill('dark.colorEdge'),
    ]);
    expect(problems[0]?.message).toBe(
      'In the light scheme, muted on canvas is 2.6:1. It needs at least 4.5:1.',
    );
    expect(problems[4]?.message).toMatch(/^In the dark scheme, edge on canvas is .*3:1\.$/);
  });
});
