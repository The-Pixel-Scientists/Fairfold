// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's `theme.css` (ADR 0019): custom properties that override those
// packages/ui/src/tokens.css defines, built from validated tokens only. The
// brand colour must parse and pass contrast; every other value is derived
// from it or fixed per preset, so no text a tenant typed reaches the CSS.

import { deriveShades, themeSchema, type Preset } from '../theme.ts';

/**
 * Corner radii, and the canvas and sunken surfaces. Each surface is at least
 * as light as the standard one, so a brand colour that passes contrast on
 * the standard surfaces passes on these.
 */
export const presetTokens = {
  standard: {
    radiusSm: '0.25rem',
    radiusMd: '0.375rem',
    radiusLg: '0.5rem',
    canvas: '#f5f6f8',
    sunken: '#eceef2',
  },
  rounded: {
    radiusSm: '0.5rem',
    radiusMd: '0.75rem',
    radiusLg: '1rem',
    canvas: '#f8f7f4',
    sunken: '#f0efea',
  },
  square: { radiusSm: '0', radiusMd: '0', radiusLg: '0', canvas: '#f6f6f6', sunken: '#eeeeee' },
} as const satisfies Record<
  Preset,
  { radiusSm: string; radiusMd: string; radiusLg: string; canvas: string; sunken: string }
>;

const tokensSchema = themeSchema.pick({ brandColour: true, preset: true });

/** Throws if the tokens fail the theme schema, contrast included. */
export function themeCss(tokens: { brandColour: string; preset: Preset }): string {
  // Only these two keys: a stored theme row may carry others.
  const parsed = tokensSchema.safeParse({ brandColour: tokens.brandColour, preset: tokens.preset });
  if (!parsed.success) throw new TypeError('The theme tokens are not valid.');
  const { brand, hover, tint } = deriveShades(parsed.data.brandColour);
  const preset = presetTokens[parsed.data.preset];
  const properties = [
    ['--color-accent', brand],
    ['--color-accent-hover', hover],
    ['--color-accent-soft', tint],
    ['--color-canvas', preset.canvas],
    ['--color-sunken', preset.sunken],
    ['--radius-sm', preset.radiusSm],
    ['--radius-md', preset.radiusMd],
    ['--radius-lg', preset.radiusLg],
  ];
  return `:root {\n${properties.map(([name, value]) => `  ${name}: ${value};\n`).join('')}}\n`;
}
