// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tenant's theme tokens (ADR 0019). The brand colour and the shades made
// from it must keep WCAG 2.2 AA contrast, so parsing refuses a colour that
// fails and suggests the nearest darker one that passes. The same check runs
// in the browser and on the server.

import { z } from 'zod';

import { catalogueParams, messages, type FieldProblem } from './messages.ts';

export const presets = ['standard', 'rounded', 'square'] as const;

export type Preset = (typeof presets)[number];

export const presetLabels: Record<Preset, string> = {
  standard: 'Standard',
  rounded: 'Rounded',
  square: 'Square',
};

export const logoTypes = ['image/png', 'image/webp'] as const;

export type LogoType = (typeof logoTypes)[number];

/** WCAG 2.2 AA for normal text. */
export const MIN_CONTRAST = 4.5;

const HEX = /^#[0-9a-fA-F]{6}$/;
const WHITE = '#ffffff';
const BLACK = '#000000';
/** From packages/ui/src/tokens.css: body text, and the surfaces brand-coloured text sits on. */
const INK = '#161a20';
const SURFACES = [WHITE, '#f5f6f8', '#eceef2'];
/** How far the hover shade moves towards black, and the tint towards white. */
const HOVER_DARKEN = 0.2;
const TINT_LIGHTEN = 0.9;

function channels(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new Error('A colour must be a hex code such as #1f4bb8.');
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

/** Moves a colour `amount` (0 to 1) of the way towards another. */
function mix(from: string, to: string, amount: number): string {
  const target = channels(to);
  return toHex(channels(from).map((value, i) => value + ((target[i] ?? value) - value) * amount));
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/** The colours the apps use for the brand: buttons and links, their hover state, and a soft background. */
export interface ThemeShades {
  brand: string;
  hover: string;
  tint: string;
}

export function deriveShades(brandColour: string): ThemeShades {
  const brand = brandColour.toLowerCase();
  return {
    brand,
    hover: mix(brand, BLACK, HOVER_DARKEN),
    tint: mix(brand, WHITE, TINT_LIGHTEN),
  };
}

/**
 * Every pair the apps draw reaches AA: brand-coloured text on each surface
 * and on its own tint, white text on the brand and its hover shade, and body
 * text on the tint.
 */
function passes(brandColour: string): boolean {
  const { brand, hover, tint } = deriveShades(brandColour);
  const pairs = [
    ...[...SURFACES, tint].map((surface) => [brand, surface]),
    [hover, WHITE],
    [INK, tint],
  ] as const;
  return pairs.every(([a, b]) => contrastRatio(a, b) >= MIN_CONTRAST);
}

/** The nearest darker shade of the colour that passes. Black always does. */
function suggestColour(brandColour: string): string {
  for (let step = 1; step < 100; step += 1) {
    const candidate = mix(brandColour, BLACK, step / 100);
    if (passes(candidate)) return candidate;
  }
  return BLACK;
}

export interface ThemeCheck {
  problems: FieldProblem[];
  shades: ThemeShades;
  /** A passing colour to offer when the brand colour fails. */
  suggestion: string | null;
}

/** For the theme screen's preview: the shades, and what to offer if the colour fails. */
export function checkTheme(theme: { brandColour: string }): ThemeCheck {
  const shades = deriveShades(theme.brandColour);
  if (passes(shades.brand)) return { problems: [], shades, suggestion: null };
  const suggestion = suggestColour(shades.brand);
  return {
    problems: [{ field: 'brandColour', message: messages.brandColourContrast(suggestion) }],
    shades,
    suggestion,
  };
}

/** `#rrggbb` in either case, stored in lower case, refused if it fails contrast. */
export const brandColourSchema = z
  .string()
  .regex(HEX, { error: messages.brandColourFormat })
  .toLowerCase()
  .superRefine((colour, context) => {
    // Zod runs this even after the format check fails.
    if (!HEX.test(colour)) return;
    for (const problem of checkTheme({ brandColour: colour }).problems) {
      context.addIssue({ code: 'custom', message: problem.message, params: catalogueParams });
    }
  });

export const themeSchema = z.strictObject({
  brandColour: brandColourSchema,
  preset: z.enum(presets),
  logoType: z.enum(logoTypes).nullable(),
});

export type Theme = z.infer<typeof themeSchema>;

/** Matches the accent in packages/ui/src/tokens.css. */
export const defaultTheme: Theme = { brandColour: '#1f4bb8', preset: 'standard', logoType: null };
