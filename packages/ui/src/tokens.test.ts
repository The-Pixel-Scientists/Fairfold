// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
const stylesCss = readFileSync(join(import.meta.dirname, 'styles.css'), 'utf8');

/** Every `--color-name: #rrggbb;` declaration in the tokens file. */
function readColours(css: string): Map<string, string> {
  const colours = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) colours.set(name, value.toLowerCase());
  }
  return colours;
}

const colours = readColours(tokensCss);

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

function colour(name: string): string {
  const value = colours.get(name);
  if (value === undefined) throw new Error(`There is no --color-${name} token.`);
  return value;
}

const surfaces = ['canvas', 'surface', 'sunken'];

/** Text and the surfaces it appears on: 4.5:1 (WCAG 1.4.3). */
const textPairs: [foreground: string, backgrounds: string[]][] = [
  ['ink', [...surfaces, 'accent-soft', 'danger-soft', 'success-soft', 'warning-soft']],
  ['muted', [...surfaces, 'accent-soft']],
  ['accent', [...surfaces, 'accent-soft']],
  ['on-accent', ['accent', 'accent-hover']],
  ['danger', [...surfaces, 'danger-soft']],
  ['on-danger', ['danger', 'danger-hover']],
  ['success', ['surface', 'success-soft']],
  ['warning', ['surface', 'warning-soft']],
];

/** Borders, the focus ring and filled controls against what surrounds them: 3:1 (WCAG 1.4.11). */
const uiPairs: [foreground: string, backgrounds: string[]][] = [
  ['edge', surfaces],
  ['focus', [...surfaces, 'accent-soft', 'danger-soft', 'success-soft', 'warning-soft']],
  ['accent', surfaces],
  ['danger', surfaces],
];

/** Colours that are decoration only, so they need no contrast of their own. */
const decorative = new Set(['divider']);

describe('colour tokens', () => {
  it('reads every colour as a six-digit hex value', () => {
    // The theme resets the colour namespace with `--color-*: initial`, which the pattern skips.
    const declared = [...tokensCss.matchAll(/--color-([a-z-]+):/g)].map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(10);
    expect([...colours.keys()].sort()).toEqual([...declared].sort());
  });

  it.each(textPairs.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg] as const)))(
    'text colour %s on %s has a contrast ratio of at least 4.5:1',
    (foreground, background) => {
      expect(contrast(colour(foreground), colour(background))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(uiPairs.flatMap(([fg, bgs]) => bgs.map((bg) => [fg, bg] as const)))(
    'interface colour %s on %s has a contrast ratio of at least 3:1',
    (foreground, background) => {
      expect(contrast(colour(foreground), colour(background))).toBeGreaterThanOrEqual(3);
    },
  );

  it('checks every colour token, so a new colour cannot skip the test', () => {
    const checked = new Set<string>();
    for (const [foreground, backgrounds] of [...textPairs, ...uiPairs]) {
      checked.add(foreground);
      for (const background of backgrounds) checked.add(background);
    }
    for (const name of colours.keys()) {
      if (!decorative.has(name)) expect(checked, `--color-${name} is not checked`).toContain(name);
    }
  });

  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
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
