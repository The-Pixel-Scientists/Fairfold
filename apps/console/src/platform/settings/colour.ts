// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The brand colour check as a person sees it while typing: the words
// the API uses, the contrast found, and a colour that passes.

import {
  MIN_CONTRAST,
  checkTheme,
  contrastRatio,
  deriveShades,
} from '@pixel-scientists/domain/platform';

const HEX = /^#[0-9a-f]{6}$/i;
const SUGGESTION = /#[0-9a-f]{6}/i;
/** The darkest surface the brand colour sits on, from packages/ui/src/tokens.css (`sunken`), and white. */
const SUNKEN = '#eceef2';
const WHITE = '#ffffff';

export const isHexColour = (value: string): boolean => HEX.test(value);

/**
 * The lowest contrast the check measures for a colour: as text on the darkest
 * surface and on its own tint, and its hover shade behind white text. The
 * other pairs the check makes (white, the page, body text on the tint) are
 * never lower, so this is the figure that decides.
 */
export function lowestContrast(brandColour: string): number {
  const { brand, hover, tint } = deriveShades(brandColour);
  return Math.min(
    contrastRatio(brand, SUNKEN),
    contrastRatio(brand, tint),
    contrastRatio(hover, WHITE),
  );
}

/** A ratio as shown: rounded down, so a colour that fails never reads as the minimum. */
export function showRatio(ratio: number): string {
  return (Math.floor(ratio * 10) / 10).toFixed(1);
}

export interface ColourProblem {
  /** The catalogue's words, the API's or the browser's. */
  message: string;
  /** The contrast found, as shown, with the minimum alongside. */
  contrast: string;
  /** A colour that passes, to offer. */
  suggestion: string | null;
}

/**
 * What is wrong with a colour that is a complete hex code, or null when it
 * passes. `refusal` is what the API said about this colour, which is used
 * when the check here finds nothing to say.
 */
export function colourProblem(value: string, refusal?: string): ColourProblem | null {
  if (!isHexColour(value)) return null;
  const { problems, suggestion } = checkTheme({ brandColour: value });
  const message = problems[0]?.message ?? refusal;
  if (message === undefined) return null;
  return {
    message,
    contrast: `Contrast found: ${showRatio(lowestContrast(value))} to 1. The minimum is ${String(MIN_CONTRAST)} to 1.`,
    suggestion: suggestion ?? SUGGESTION.exec(message)?.[0]?.toLowerCase() ?? null,
  };
}
