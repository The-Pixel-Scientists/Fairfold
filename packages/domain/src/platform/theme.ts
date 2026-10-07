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
const INK = '#17181b';
const SURFACES = [WHITE, '#f7f7f5', '#efefec'];
/** The same, from the dark scheme in tokens.css, with its muted text and the text on the accent. */
const DARK_INK = '#ececea';
const DARK_MUTED = '#a3a6ac';
const DARK_ON_ACCENT = '#141518';
const DARK_SURFACES = ['#111214', '#18191c', '#212226'];
/** The dark scheme's own accent shades, which a colour with no hue (ink) keeps. */
const DARK_NEUTRAL: ThemeShades = { brand: DARK_INK, hover: WHITE, tint: '#2a2c30' };
/**
 * How far the hover shade moves towards black, or towards white for a colour
 * too dark to show a darker hover, and the tint towards white.
 */
const HOVER_DARKEN = 0.2;
const HOVER_LIGHTEN = 0.12;
const TOO_DARK_TO_DARKEN = 0.03;
const TINT_LIGHTEN = 0.9;
/** OKLab lightness of the dark scheme's accent, its hover and its tint; below this chroma a colour has no hue. */
const DARK_BRAND_LIGHTNESS = 0.82;
const DARK_HOVER_LIGHTNESS = 0.89;
const DARK_TINT_LIGHTNESS = 0.27;
const DARK_TINT_CHROMA = 0.35;
const NEUTRAL_CHROMA = 0.02;

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

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => toLinear(value / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A colour in OKLab (Björn Ottosson, 2020): lightness from 0 to 1, then two axes of hue. */
function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((value) => toLinear(value / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The hex colour for an OKLab value, or null if it is outside what a screen can show. */
function fromOklab(lightness: number, a: number, b: number): string | null {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (rgb.some((c) => c < -0.0001 || c > 1.0001)) return null;
  return toHex(rgb.map((c) => toGamma(Math.min(1, Math.max(0, c))) * 255));
}

/** The colour's hue at another lightness, with its chroma scaled, and reduced further until a screen can show it. */
function atLightness(hex: string, lightness: number, chroma = 1): string {
  const [, a, b] = toOklab(hex);
  for (let step = 0; step < 20; step += 1) {
    const scale = chroma * (1 - step / 20);
    const colour = fromOklab(lightness, a * scale, b * scale);
    if (colour !== null) return colour;
  }
  return fromOklab(lightness, 0, 0) ?? WHITE;
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
    hover:
      relativeLuminance(brand) < TOO_DARK_TO_DARKEN
        ? mix(brand, WHITE, HOVER_LIGHTEN)
        : mix(brand, BLACK, HOVER_DARKEN),
    tint: mix(brand, WHITE, TINT_LIGHTEN),
  };
}

/** Every pair the dark scheme draws with the shades reaches AA, as passes() checks for the light one. */
function passesDark({ brand, hover, tint }: ThemeShades): boolean {
  const pairs = [
    ...[...DARK_SURFACES, tint].map((surface) => [brand, surface]),
    [brand, DARK_ON_ACCENT],
    [hover, DARK_ON_ACCENT],
    [DARK_INK, tint],
    [DARK_MUTED, tint],
  ] as const;
  return pairs.every(([a, b]) => contrastRatio(a, b) >= MIN_CONTRAST);
}

/**
 * The brand's shades for the dark scheme. Ink, or any colour without a hue,
 * becomes the scheme's own paper white; a colour keeps its hue at a lightness
 * that reads on a dark page, with a dark tint of it behind the current page.
 * Every colour that passes the light check gets shades that pass in the dark:
 * if rounding ever left one short, it moves towards white until it passes.
 */
export function deriveDarkShades(brandColour: string): ThemeShades {
  const [, a, b] = toOklab(brandColour.toLowerCase());
  if (Math.hypot(a, b) < NEUTRAL_CHROMA) return DARK_NEUTRAL;
  let shades: ThemeShades = {
    brand: atLightness(brandColour, DARK_BRAND_LIGHTNESS),
    hover: atLightness(brandColour, DARK_HOVER_LIGHTNESS),
    tint: atLightness(brandColour, DARK_TINT_LIGHTNESS, DARK_TINT_CHROMA),
  };
  for (let step = 1; step <= 20 && !passesDark(shades); step += 1) {
    shades = {
      ...shades,
      brand: mix(shades.brand, WHITE, step / 20),
      hover: mix(shades.hover, WHITE, step / 20),
    };
  }
  return shades;
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
export const defaultTheme: Theme = { brandColour: '#1b1d21', preset: 'standard', logoType: null };
