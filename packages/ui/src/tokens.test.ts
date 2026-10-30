// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** What the tests use of the domain package's tokens (ADR 0046). */
interface DomainTokens {
  contrastPairs: readonly { foreground: string; background: string; minimum: number }[];
  defaultTokens: unknown;
  fonts: Record<string, { stack: string }>;
  tokenDefinitions: readonly {
    path: string;
    property: string;
    kind: 'colour' | 'length' | 'font';
  }[];
  tokenValue: (tokens: unknown, path: string) => string | number;
}

// This package does not depend on the domain package, so its tokens are
// loaded by path. Import them by name once the workspace dependency is added.
const domainTokens = '../../domain/src/platform/theme-tokens.ts';
const { contrastPairs, defaultTokens, fonts, tokenDefinitions, tokenValue } = (await import(
  /* @vite-ignore */ domainTokens
)) as DomainTokens;

const tokensCss = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
const stylesCss = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');
const schemeJs = readFileSync(join(import.meta.dirname, 'public', 'scheme.js'), 'utf8');

const DARK_SELECTOR = ":root[data-scheme='dark']";
const lightCss = tokensCss.slice(0, tokensCss.indexOf(DARK_SELECTOR));
const darkCss = tokensCss.slice(tokensCss.indexOf(DARK_SELECTOR));

/** Every `--color-name: #rrggbb;` declaration in a stretch of the tokens file. */
function readColours(css: string): Map<string, string> {
  const colours = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) colours.set(name, value.toLowerCase());
  }
  return colours;
}

const schemes = { light: readColours(lightCss), dark: readColours(darkCss) };

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, WCAG 2.2 section 1.4.3. */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function colour(scheme: keyof typeof schemes, name: string): string {
  const value = schemes[scheme].get(name);
  if (value === undefined) throw new Error(`There is no ${scheme} --color-${name} token.`);
  return value;
}

/** The custom property name without `--color-`, for a domain colour key such as `colorAccentHover`. */
const cssName = (key: string) => {
  const token = tokenDefinitions.find((definition) => definition.path === `light.${key}`);
  if (token === undefined) throw new Error(`There is no token ${key}.`);
  return token.property.slice('--color-'.length);
};

/** The domain package's list of pairs, so a funder's look meets the bar the default look does. */
const pairs = (['light', 'dark'] as const).flatMap((scheme) =>
  contrastPairs.map(
    ({ foreground, background, minimum }) =>
      [scheme, cssName(foreground), cssName(background), minimum] as const,
  ),
);

describe('colour tokens', () => {
  it('reads every colour as a six-digit hex value', () => {
    // The theme resets the colour namespace with `--color-*: initial`, which the pattern skips.
    const declared = [...tokensCss.matchAll(/--color-([a-z-]+):/g)].map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(20);
    expect([...schemes.light.keys(), ...schemes.dark.keys()].sort()).toEqual([...declared].sort());
  });

  it('gives every colour a value in each scheme', () => {
    expect([...schemes.dark.keys()].sort()).toEqual([...schemes.light.keys()].sort());
  });

  it.each(pairs)(
    '%s: %s on %s has a contrast ratio of at least %s:1',
    (scheme, foreground, background, minimum) => {
      expect(
        contrast(colour(scheme, foreground), colour(scheme, background)),
      ).toBeGreaterThanOrEqual(minimum);
    },
  );

  it('checks every colour token but the divider, so a new colour cannot skip the test', () => {
    const checked = new Set(
      pairs.flatMap(([, foreground, background]) => [foreground, background]),
    );
    for (const name of schemes.light.keys()) {
      if (name !== 'divider') expect(checked, `--color-${name} is not checked`).toContain(name);
    }
    expect(checked).not.toContain('divider');
  });

  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

/** The first value a stretch of the tokens file gives a custom property. */
function declared(css: string, property: string): string {
  const needle = `${property}:`;
  for (let at = css.indexOf(needle); at !== -1; at = css.indexOf(needle, at + 1)) {
    if (/[\w-]/.test(css.charAt(at - 1))) continue; // part of a longer name
    const end = css.indexOf(';', at);
    if (end === -1) break;
    return css
      .slice(at + needle.length, end)
      .replace(/\s+/g, ' ')
      .trim();
  }
  throw new Error(`${property} is not declared.`);
}

describe('default tokens', () => {
  // ADR 0046: tokens.css and the domain package's defaults are one look, written twice.
  it.each(tokenDefinitions.map((token) => [token.path, token] as const))(
    'gives %s the same value in tokens.css and in defaultTokens',
    (path, token) => {
      const value = tokenValue(defaultTokens, path);
      const css = declared(path.startsWith('dark.') ? darkCss : lightCss, token.property);
      if (token.kind === 'font') expect(css).toBe(fonts[String(value)]?.stack);
      else if (token.kind === 'colour') expect(css.toLowerCase()).toBe(value);
      else expect(css === '0' ? 0 : Number.parseFloat(css)).toBe(value);
    },
  );

  it('writes every length in tokens.css in rem, as a stylesheet does', () => {
    for (const token of tokenDefinitions.filter(({ kind }) => kind === 'length')) {
      expect(declared(lightCss, token.property)).toMatch(/^(?:0|[\d.]+rem)$/);
    }
  });
});

describe('colour schemes', () => {
  it('gives the dark tokens and the dark colour scheme the same selector', () => {
    expect(stylesCss).toContain(`${DARK_SELECTOR} {\n    color-scheme: dark;`);
  });

  it('keeps the start-up script and the switch on the same storage key and attribute', () => {
    expect(schemeJs).toContain("getItem('colour-scheme')");
    expect(schemeJs).toContain('document.documentElement.dataset.scheme');
  });
});

describe('size and motion tokens', () => {
  it('keeps every control at least 24px tall in both densities', () => {
    const heights = [...tokensCss.matchAll(/--density-control-height:\s*([\d.]+)rem/g)].map(
      (match) => Number(match[1]) * 16,
    );
    expect(heights).toHaveLength(2);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(24);
    expect(tokensCss).toMatch(/--spacing-target:\s*24px/);
  });

  it('sets the focus ring at least 2px thick', () => {
    const match = /--focus-ring-width:\s*(\d+)px/.exec(tokensCss);
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(2);
  });

  it('turns motion off under prefers-reduced-motion', () => {
    expect(stylesCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(stylesCss).toMatch(/--motion-fast:\s*0ms/);
    expect(stylesCss).toMatch(/--motion-normal:\s*0ms/);
    expect(stylesCss).toMatch(/transition-duration:\s*0\.01ms/);
    expect(stylesCss).toMatch(/animation-duration:\s*0\.01ms/);
  });
});
