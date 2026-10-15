// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's `theme.css` (ADR 0019, ADR 0046): custom properties that
// override those packages/ui/src/tokens.css defines, from a preset look or a
// funder's own tokens. A preset look's brand colour must parse and pass
// contrast, and every other value is derived from it or fixed per preset.
// Tokens are checked again with their schema and checkTokens(), and each
// value is written from its parsed form, so no text a tenant typed reaches
// the CSS. There is a block for each colour scheme (ADR 0045), chosen by the
// page element's data-scheme as in tokens.css, and for tokens one for the
// portal's comfortable density.

import { deriveDarkShades, deriveShades, themeSchema, type Preset } from '../theme.ts';
import {
  checkTokens,
  defaultTokens,
  fonts,
  tokenDefinitions,
  tokenSetSchema,
  tokenValue,
  type TokenDefinition,
  type TokenSet,
} from '../theme-tokens.ts';

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

const lookSchema = themeSchema.pick({ brandColour: true, preset: true });

/** A preset and brand colour, as most funders keep them. */
export interface PresetLook {
  brandColour: string;
  preset: Preset;
}

/** What theme.css is built from: a preset look, or a funder's own tokens. */
export type ThemeLook = PresetLook | { tokens: TokenSet };

/** The selector of the dark scheme's block, as tokens.css writes it. */
export const DARK_SCHEME_SELECTOR = ":root[data-scheme='dark']";

/** The selector of the portal's density, where a funder's type scale and spacing apply. */
export const COMFORTABLE_SELECTOR = "[data-density='comfortable']";

type Declarations = readonly (readonly [name: string, value: string])[];

const notValid = () => new TypeError('The theme tokens are not valid.');

function parsePresetLook(look: PresetLook): PresetLook {
  // Only these two keys: a stored theme row may carry others.
  const parsed = lookSchema.safeParse({ brandColour: look.brandColour, preset: look.preset });
  if (!parsed.success) throw notValid();
  return parsed.data;
}

/** The effective tokens of a preset look, so it can be downloaded as a stylesheet. */
export function tokensFromPreset(brandColour: string, preset: Preset): TokenSet {
  const look = parsePresetLook({ brandColour, preset });
  const light = deriveShades(look.brandColour);
  const dark = deriveDarkShades(look.brandColour);
  const tokens = presetTokens[look.preset];
  return {
    ...defaultTokens,
    light: {
      ...defaultTokens.light,
      colorAccent: light.brand,
      colorAccentHover: light.hover,
      colorAccentSoft: light.tint,
      colorCanvas: tokens.canvas,
      colorSunken: tokens.sunken,
    },
    dark: {
      ...defaultTokens.dark,
      colorAccent: dark.brand,
      colorAccentHover: dark.hover,
      colorAccentSoft: dark.tint,
      colorCanvas: tokens.darkCanvas,
      colorSunken: tokens.darkSunken,
    },
    radii: {
      radiusSm: Number.parseFloat(tokens.radiusSm),
      radiusMd: Number.parseFloat(tokens.radiusMd),
      radiusLg: Number.parseFloat(tokens.radiusLg),
    },
  };
}

const HEX = /^#[0-9a-f]{6}$/;

/** A checked value as CSS: lower-case hex, a number of rem, or the font's fixed stack. */
function cssValue(token: TokenDefinition, value: string | number): string {
  if (token.kind === 'colour' && typeof value === 'string' && HEX.test(value)) return value;
  if (token.kind === 'length' && typeof value === 'number' && Number.isFinite(value)) {
    return value === 0 ? '0' : `${Number(value.toFixed(3))}rem`;
  }
  if (token.kind === 'font' && typeof value === 'string' && Object.hasOwn(fonts, value)) {
    return fonts[value as keyof typeof fonts].stack;
  }
  throw notValid();
}

function tokenProperties(tokens: unknown) {
  const parsed = tokenSetSchema.safeParse(tokens);
  if (!parsed.success || checkTokens(parsed.data).length > 0) throw notValid();
  const blocks = { root: [], dark: [], comfortable: [] } as Record<
    TokenDefinition['block'],
    [string, string][]
  >;
  for (const token of tokenDefinitions) {
    blocks[token.block].push([
      token.property,
      cssValue(token, tokenValue(parsed.data, token.path)),
    ]);
  }
  return { light: blocks.root, dark: blocks.dark, comfortable: blocks.comfortable };
}

/**
 * The custom properties for each scheme, and for tokens the comfortable
 * density. Throws if a preset look fails the theme schema, or tokens fail
 * their schema or a contrast pair.
 */
export function themeProperties(look: ThemeLook): {
  light: Declarations;
  dark: Declarations;
  comfortable: Declarations;
} {
  if ('tokens' in look) return tokenProperties(look.tokens);
  const { brandColour, preset } = parsePresetLook(look);
  const light = deriveShades(brandColour);
  const dark = deriveDarkShades(brandColour);
  const tokens = presetTokens[preset];
  return {
    light: [
      ['--color-accent', light.brand],
      ['--color-accent-hover', light.hover],
      ['--color-accent-soft', light.tint],
      ['--color-canvas', tokens.canvas],
      ['--color-sunken', tokens.sunken],
      ['--radius-sm', tokens.radiusSm],
      ['--radius-md', tokens.radiusMd],
      ['--radius-lg', tokens.radiusLg],
    ],
    dark: [
      ['--color-accent', dark.brand],
      ['--color-accent-hover', dark.hover],
      ['--color-accent-soft', dark.tint],
      ['--color-canvas', tokens.darkCanvas],
      ['--color-sunken', tokens.darkSunken],
    ],
    comfortable: [],
  };
}

function block(selector: string, declarations: Declarations): string {
  return `${selector} {\n${declarations.map(([name, value]) => `  ${name}: ${value};\n`).join('')}}\n`;
}

/** Throws as themeProperties() does. */
export function themeCss(look: ThemeLook): string {
  const { light, dark, comfortable } = themeProperties(look);
  return [
    block(':root', light),
    block(DARK_SCHEME_SELECTOR, dark),
    ...(comfortable.length > 0 ? [block(COMFORTABLE_SELECTOR, comfortable)] : []),
  ].join('\n');
}
