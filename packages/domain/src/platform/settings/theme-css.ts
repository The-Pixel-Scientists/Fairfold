// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's `theme.css` (ADR 0019): custom properties that override those
// packages/ui/src/tokens.css defines, built from validated tokens only. The
// brand colour must parse and pass contrast; every other value is derived
// from it or fixed per preset, so no text a tenant typed reaches the CSS.
// There is a block for each colour scheme (ADR 0045): the dark one is chosen
// by the page element's data-scheme, as in tokens.css.

import { deriveDarkShades, deriveShades, themeSchema, type Preset } from '../theme.ts';

/**
 * Corner radii, and the canvas and sunken surfaces in each scheme. Each light
 * surface is at least as light as the standard one, and each dark surface at
 * least as dark, so a brand colour that passes contrast on the standard
 * surfaces passes on these.
 */
export const presetTokens = {
  standard: {
    radiusSm: '0.25rem',
    radiusMd: '0.375rem',
    radiusLg: '0.5rem',
    canvas: '#f7f7f5',
    sunken: '#efefec',
    darkCanvas: '#111214',
    darkSunken: '#212226',
  },
  rounded: {
    radiusSm: '0.5rem',
    radiusMd: '0.75rem',
    radiusLg: '1rem',
    canvas: '#f8f7f4',
    sunken: '#f1f0eb',
    darkCanvas: '#12110e',
    darkSunken: '#23211d',
  },
  square: {
    radiusSm: '0',
    radiusMd: '0',
    radiusLg: '0',
    canvas: '#f7f7f7',
    sunken: '#efefef',
    darkCanvas: '#111111',
    darkSunken: '#212121',
  },
} as const satisfies Record<
  Preset,
  {
    radiusSm: string;
    radiusMd: string;
    radiusLg: string;
    canvas: string;
    sunken: string;
    darkCanvas: string;
    darkSunken: string;
  }
>;

const tokensSchema = themeSchema.pick({ brandColour: true, preset: true });

/** The selector of the dark scheme's block, as tokens.css writes it. */
export const DARK_SCHEME_SELECTOR = ":root[data-scheme='dark']";

type Declarations = readonly (readonly [name: string, value: string])[];

/** The custom properties for each scheme. Throws if the tokens fail the theme schema, contrast included. */
export function themeProperties(tokens: { brandColour: string; preset: Preset }): {
  light: Declarations;
  dark: Declarations;
} {
  // Only these two keys: a stored theme row may carry others.
  const parsed = tokensSchema.safeParse({ brandColour: tokens.brandColour, preset: tokens.preset });
  if (!parsed.success) throw new TypeError('The theme tokens are not valid.');
  const light = deriveShades(parsed.data.brandColour);
  const dark = deriveDarkShades(parsed.data.brandColour);
  const preset = presetTokens[parsed.data.preset];
  return {
    light: [
      ['--color-accent', light.brand],
      ['--color-accent-hover', light.hover],
      ['--color-accent-soft', light.tint],
      ['--color-canvas', preset.canvas],
      ['--color-sunken', preset.sunken],
      ['--radius-sm', preset.radiusSm],
      ['--radius-md', preset.radiusMd],
      ['--radius-lg', preset.radiusLg],
    ],
    dark: [
      ['--color-accent', dark.brand],
      ['--color-accent-hover', dark.hover],
      ['--color-accent-soft', dark.tint],
      ['--color-canvas', preset.darkCanvas],
      ['--color-sunken', preset.darkSunken],
    ],
  };
}

function block(selector: string, declarations: Declarations): string {
  return `${selector} {\n${declarations.map(([name, value]) => `  ${name}: ${value};\n`).join('')}}\n`;
}

/** Throws if the tokens fail the theme schema, contrast included. */
export function themeCss(tokens: { brandColour: string; preset: Preset }): string {
  const { light, dark } = themeProperties(tokens);
  return `${block(':root', light)}\n${block(DARK_SCHEME_SELECTOR, dark)}`;
}
