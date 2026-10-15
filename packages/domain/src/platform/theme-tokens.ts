// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A funder's own design tokens (ADR 0046): light and dark colours, corner
// radii, a font from a fixed list, and the portal's type scale and density.
// Each token maps to one custom property in packages/ui/src/tokens.css. The
// schema, its bounds and checkTokens() are the boundary: the server checks
// every token set with them before writing a value into `theme.css`.

import { z } from 'zod';

import { catalogueParams, messages, type FieldProblem } from './messages.ts';
import { contrastRatio, MIN_CONTRAST } from './theme.ts';

/** WCAG 2.2 AA for borders, the focus ring and filled controls (1.4.11). */
export const MIN_INTERFACE_CONTRAST = 3;

const SYSTEM_STACK =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** The fonts a funder may choose, each written into CSS as its fixed stack. */
export const fonts = {
  atkinson: {
    label: 'Atkinson Hyperlegible Next',
    stack: `'Atkinson Hyperlegible Next', ${SYSTEM_STACK}`,
  },
  system: { label: 'The device’s own font', stack: SYSTEM_STACK },
} as const;

export type FontId = keyof typeof fonts;

const fontIds = Object.keys(fonts) as [FontId, ...FontId[]];

/** Each colour token, with what it colours. Light and dark use the same names. */
const colourAbout = {
  colorCanvas: ['--color-canvas', 'The page, behind every panel'],
  colorSurface: ['--color-surface', 'Panels, cards, fields and dialogs'],
  colorSunken: ['--color-sunken', 'Areas set into a panel, such as table headings'],
  colorInk: ['--color-ink', 'Body text and headings'],
  colorMuted: ['--color-muted', 'Hints, labels and other secondary text'],
  colorEdge: ['--color-edge', 'The outlines of fields and other controls'],
  colorDivider: ['--color-divider', 'Lines between rows and sections'],
  colorAccent: ['--color-accent', 'Links, main buttons and the current page'],
  colorAccentHover: ['--color-accent-hover', 'Main buttons under the pointer'],
  colorAccentSoft: ['--color-accent-soft', 'Behind the current page in navigation'],
  colorOnAccent: ['--color-on-accent', 'Text on main buttons'],
  colorDanger: ['--color-danger', 'Errors and buttons that delete'],
  colorDangerHover: ['--color-danger-hover', 'Buttons that delete, under the pointer'],
  colorDangerSoft: ['--color-danger-soft', 'Behind error messages'],
  colorOnDanger: ['--color-on-danger', 'Text on buttons that delete'],
  colorSuccess: ['--color-success', 'Success messages and tags'],
  colorSuccessSoft: ['--color-success-soft', 'Behind success messages'],
  colorWarning: ['--color-warning', 'Warnings'],
  colorWarningSoft: ['--color-warning-soft', 'Behind warnings'],
  colorInfo: ['--color-info', 'Information messages'],
  colorInfoSoft: ['--color-info-soft', 'Behind information messages'],
  colorFocus: ['--color-focus', 'The focus ring round whatever the keyboard is on'],
} as const;

export type ColourKey = keyof typeof colourAbout;

const colourKeys = Object.keys(colourAbout) as ColourKey[];

export interface ContrastPair {
  readonly foreground: ColourKey;
  readonly background: ColourKey;
  readonly minimum: number;
}

const surfaces: ColourKey[] = ['colorCanvas', 'colorSurface', 'colorSunken'];
const softs: ColourKey[] = [
  'colorAccentSoft',
  'colorDangerSoft',
  'colorSuccessSoft',
  'colorWarningSoft',
  'colorInfoSoft',
];

function pairs(minimum: number, list: [ColourKey, ColourKey[]][]): ContrastPair[] {
  return list.flatMap(([foreground, backgrounds]) =>
    backgrounds.map((background) => ({ foreground, background, minimum })),
  );
}

/**
 * Every pair checked in both schemes: text on each surface it appears on at
 * 4.5:1, then borders, the focus ring and filled controls at 3:1. The divider
 * is decoration, so it is in no pair.
 */
export const contrastPairs: readonly ContrastPair[] = [
  ...pairs(MIN_CONTRAST, [
    ['colorInk', [...surfaces, ...softs]],
    ['colorMuted', [...surfaces, 'colorAccentSoft']],
    ['colorAccent', [...surfaces, 'colorAccentSoft']],
    ['colorOnAccent', ['colorAccent', 'colorAccentHover']],
    ['colorDanger', [...surfaces, 'colorDangerSoft']],
    ['colorOnDanger', ['colorDanger', 'colorDangerHover']],
    ['colorSuccess', ['colorSurface', 'colorSuccessSoft']],
    ['colorWarning', ['colorSurface', 'colorWarningSoft']],
    ['colorInfo', ['colorSurface', 'colorInfoSoft']],
  ]),
  ...pairs(MIN_INTERFACE_CONTRAST, [
    ['colorEdge', surfaces],
    ['colorFocus', [...surfaces, ...softs]],
    ['colorAccent', surfaces],
    ['colorDanger', surfaces],
  ]),
];

const typeSteps = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;

type TypeStep = (typeof typeSteps)[number];
type TypeKey = `text${Capitalize<TypeStep>}` | `text${Capitalize<TypeStep>}LineHeight`;

const sizeKey = (step: TypeStep) => `text${step[0]?.toUpperCase()}${step.slice(1)}` as TypeKey;
const leadingKey = (step: TypeStep) => `${sizeKey(step)}LineHeight` as TypeKey;
/** The smallest line height of a step, as a multiple of its size. */
const leadingMin = (step: TypeStep) => (step === 'sm' || step === 'base' ? 1.4 : 1.1);

/** Lengths in rem: the custom property, what it sizes, and its bounds. */
interface Length {
  readonly property: string;
  readonly about: string;
  readonly min: number;
  readonly max: number;
}

const radiusAbout = {
  radiusSm: { property: '--radius-sm', about: 'Small corners, such as tags', min: 0, max: 1.5 },
  radiusMd: { property: '--radius-md', about: 'Buttons and fields', min: 0, max: 1.5 },
  radiusLg: { property: '--radius-lg', about: 'Panels and dialogs', min: 0, max: 1.5 },
} as const satisfies Record<string, Length>;

const typeAbout = Object.fromEntries(
  typeSteps.flatMap((step) => [
    [
      sizeKey(step),
      {
        property: `--text-${step}`,
        about: `Text size ${step}`,
        min: step === 'base' ? 1 : 0.75,
        max: 3,
      },
    ],
    [
      leadingKey(step),
      {
        property: `--text-${step}--line-height`,
        about: `Line height of ${step}`,
        min: 0.75,
        max: 6,
      },
    ],
  ]),
) as Record<TypeKey, Length>;

const densityAbout = {
  densityControlHeight: {
    property: '--density-control-height',
    about: 'The height of buttons and fields',
    min: 2.5,
    max: 3.5,
  },
  densityControlPx: {
    property: '--density-control-px',
    about: 'Space either side of a button’s or field’s text',
    min: 0.5,
    max: 1.5,
  },
  densityBodySize: { property: '--density-body-size', about: 'Body text', min: 1, max: 1.25 },
  densityBodyLeading: {
    property: '--density-body-leading',
    about: 'Line height of body text',
    min: 1.4,
    max: 2.5,
  },
  densityGutter: {
    property: '--density-gutter',
    about: 'Space round the page’s content',
    min: 0.25,
    max: 3,
  },
  densityStack: { property: '--density-stack', about: 'Space between sections', min: 0.25, max: 3 },
  densityFieldGap: {
    property: '--density-field-gap',
    about: 'Space between a label, its hint and its field',
    min: 0.25,
    max: 3,
  },
} as const satisfies Record<string, Length>;

/** A length as CSS writes it: `0`, or a number of rem. */
export const remText = (value: number) => (value === 0 ? '0' : `${value}rem`);

/** Problems with a token's value, in the catalogue's words. A message names a token only from this file. */
export const tokenMessages = {
  length: (min: number, max: number) =>
    `Enter a length from ${remText(min)} to ${remText(max)}, like 1.125rem, with up to three decimal places.`,
  order: (smaller: string, larger: string) => `Make ${larger} at least as large as ${smaller}.`,
  lineHeight: (leading: string, size: string, min: number) =>
    `Make ${leading} between ${min} and 2 times ${size}.`,
  contrast: (
    scheme: Scheme,
    foreground: ColourKey,
    background: ColourKey,
    ratio: number,
    minimum: number,
  ) =>
    `In the ${scheme} scheme, ${colourName(foreground)} on ${colourName(background)} is ${Math.floor(ratio * 10) / 10}:1. It needs at least ${minimum}:1.`,
} as const;

function colourName(key: ColourKey): string {
  return colourAbout[key][0].slice('--color-'.length).replaceAll('-', ' ');
}

function issue(context: z.RefinementCtx, path: string, message: string) {
  context.addIssue({ code: 'custom', message, path: [path], params: catalogueParams });
}

const hexSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { error: messages.brandColourFormat })
  .toLowerCase();

/** A number of rem within bounds, with up to three decimal places. */
function remSchema({ min, max }: Length) {
  return z.number().superRefine((value, context) => {
    if (Number(value.toFixed(3)) !== value || value < min || value > max) {
      context.addIssue({
        code: 'custom',
        message: tokenMessages.length(min, max),
        params: catalogueParams,
      });
    }
  });
}

function lengths<K extends string>(about: Record<K, Length>) {
  return Object.fromEntries(
    Object.entries<Length>(about).map(([key, length]) => [key, remSchema(length)]),
  ) as Record<K, ReturnType<typeof remSchema>>;
}

const colourSchema = z.strictObject(
  Object.fromEntries(colourKeys.map((key) => [key, hexSchema])) as Record<
    ColourKey,
    typeof hexSchema
  >,
);

/** Each length in `keys` at least the one before. */
function inOrder<K extends string>(
  about: Record<K, Length>,
  keys: readonly K[],
  values: Record<K, unknown>,
  context: z.RefinementCtx,
) {
  keys.slice(1).forEach((key, i) => {
    const before = keys[i] as K;
    const [a, b] = [values[before], values[key]];
    if (typeof a === 'number' && typeof b === 'number' && b < a) {
      issue(context, key, tokenMessages.order(about[before].property, about[key].property));
    }
  });
}

/** A line height from `min` to 2 times its size. */
function leading<K extends string>(
  about: Record<K, Length>,
  [size, height]: [K, K],
  min: number,
  values: Record<K, unknown>,
  context: z.RefinementCtx,
) {
  const [a, b] = [values[size], values[height]];
  if (typeof a !== 'number' || typeof b !== 'number') return;
  if (b < a * min - 1e-9 || b > a * 2 + 1e-9) {
    issue(
      context,
      height,
      tokenMessages.lineHeight(about[height].property, about[size].property, min),
    );
  }
}

const radiusKeys = Object.keys(radiusAbout) as (keyof typeof radiusAbout)[];

/** A funder's whole look, strict at every level. Colours are stored in lower case. */
export const tokenSetSchema = z.strictObject({
  light: colourSchema,
  dark: colourSchema,
  radii: z.strictObject(lengths(radiusAbout)).superRefine((radii, context) => {
    inOrder(radiusAbout, radiusKeys, radii, context);
  }),
  font: z.enum(fontIds),
  type: z.strictObject(lengths(typeAbout)).superRefine((type, context) => {
    inOrder(typeAbout, typeSteps.map(sizeKey), type, context);
    for (const step of typeSteps) {
      leading(typeAbout, [sizeKey(step), leadingKey(step)], leadingMin(step), type, context);
    }
  }),
  density: z.strictObject(lengths(densityAbout)).superRefine((density, context) => {
    leading(densityAbout, ['densityBodySize', 'densityBodyLeading'], 1.4, density, context);
  }),
});

export type TokenSet = z.output<typeof tokenSetSchema>;

/** The look in packages/ui/src/tokens.css: ink on paper, Atkinson Hyperlegible Next, comfortable density. */
export const defaultTokens: TokenSet = {
  light: {
    colorCanvas: '#f7f7f5',
    colorSurface: '#ffffff',
    colorSunken: '#efefec',
    colorInk: '#17181b',
    colorMuted: '#5b5e64',
    colorEdge: '#7c7f86',
    colorDivider: '#e5e5e1',
    colorAccent: '#1b1d21',
    colorAccentHover: '#36383c',
    colorAccentSoft: '#e8e8e9',
    colorOnAccent: '#ffffff',
    colorDanger: '#b42318',
    colorDangerHover: '#8f1c13',
    colorDangerSoft: '#fcefed',
    colorOnDanger: '#ffffff',
    colorSuccess: '#16703f',
    colorSuccessSoft: '#e8f5ed',
    colorWarning: '#8a5000',
    colorWarningSoft: '#fcf2e0',
    colorInfo: '#2456b0',
    colorInfoSoft: '#e9f0fb',
    colorFocus: '#2457d6',
  },
  dark: {
    colorCanvas: '#111214',
    colorSurface: '#18191c',
    colorSunken: '#212226',
    colorInk: '#ececea',
    colorMuted: '#a3a6ac',
    colorEdge: '#74777f',
    colorDivider: '#2a2b2f',
    colorAccent: '#ececea',
    colorAccentHover: '#ffffff',
    colorAccentSoft: '#2a2c30',
    colorOnAccent: '#141518',
    colorDanger: '#f28b82',
    colorDangerHover: '#f6a8a1',
    colorDangerSoft: '#3a1d1b',
    colorOnDanger: '#1c0a08',
    colorSuccess: '#6fcf97',
    colorSuccessSoft: '#13291d',
    colorWarning: '#e6b45f',
    colorWarningSoft: '#2d2412',
    colorInfo: '#93b8f5',
    colorInfoSoft: '#172338',
    colorFocus: '#8ab4ff',
  },
  radii: { radiusSm: 0.25, radiusMd: 0.375, radiusLg: 0.5 },
  font: 'atkinson',
  type: {
    textXs: 0.75,
    textXsLineHeight: 1,
    textSm: 0.875,
    textSmLineHeight: 1.25,
    textBase: 1,
    textBaseLineHeight: 1.5,
    textLg: 1.125,
    textLgLineHeight: 1.75,
    textXl: 1.25,
    textXlLineHeight: 1.75,
    text2xl: 1.5,
    text2xlLineHeight: 2,
    text3xl: 1.875,
    text3xlLineHeight: 2.25,
    text4xl: 2.25,
    text4xlLineHeight: 2.625,
  },
  density: {
    densityControlHeight: 2.75,
    densityControlPx: 0.875,
    densityBodySize: 1,
    densityBodyLeading: 1.5,
    densityGutter: 1.5,
    densityStack: 1.5,
    densityFieldGap: 0.375,
  },
};

type Scheme = 'light' | 'dark';

/** Every pair below its minimum, in both schemes. Empty when the look keeps WCAG 2.2 AA. */
export function checkTokens(tokens: TokenSet): FieldProblem[] {
  return (['light', 'dark'] as const).flatMap((scheme) =>
    contrastPairs.flatMap(({ foreground, background, minimum }) => {
      const ratio = contrastRatio(tokens[scheme][foreground], tokens[scheme][background]);
      return ratio >= minimum
        ? []
        : [
            {
              field: `${scheme}.${foreground}`,
              message: tokenMessages.contrast(scheme, foreground, background, ratio, minimum),
            },
          ];
    }),
  );
}

/** The stylesheet block a token is written in: light, dark, or the portal's comfortable density. */
export type TokenBlock = 'root' | 'dark' | 'comfortable';

export interface TokenDefinition {
  /** Where the value sits in a token set, such as `dark.colorAccent`, or `font`. */
  readonly path: string;
  /** The custom property in tokens.css. */
  readonly property: string;
  readonly block: TokenBlock;
  readonly kind: 'colour' | 'length' | 'font';
  /** What it colours or sizes, and the rule it must meet. */
  readonly about: string;
}

function colourRule(key: ColourKey): string {
  const rules = [MIN_CONTRAST, MIN_INTERFACE_CONTRAST].flatMap((minimum) => {
    const on = contrastPairs
      .filter((pair) => pair.foreground === key && pair.minimum === minimum)
      .map((pair) => colourName(pair.background));
    return on.length === 0 ? [] : [`at least ${minimum}:1 on ${on.join(', ')}`];
  });
  if (rules.length > 0) return `Needs ${rules.join(', and ')}.`;
  return contrastPairs.some((pair) => pair.background === key)
    ? 'Text and controls on it are checked against it.'
    : 'Decoration only, with no contrast rule.';
}

function lengthTokens<K extends string>(
  group: string,
  about: Record<K, Length>,
  block: TokenBlock,
  rule: (key: K) => string,
): TokenDefinition[] {
  return (Object.keys(about) as K[]).map((key) => {
    const { property, min, max } = about[key];
    const bounds = `From ${remText(min)} to ${remText(max)}.`;
    return {
      path: `${group}.${key}`,
      property,
      block,
      kind: 'length',
      about: [`${about[key].about}.`, bounds, rule(key)].filter(Boolean).join(' '),
    };
  });
}

/** The rule of a length in an ordered list: at least the one before it. */
function atLeastBefore<K extends string>(about: Record<K, Length>, keys: readonly K[], key: K) {
  const before = keys[keys.indexOf(key) - 1];
  return before === undefined ? '' : `At least ${about[before].property}.`;
}

/** Every token in stylesheet order, with its block and rule. */
export const tokenDefinitions: readonly TokenDefinition[] = [
  ...(['light', 'dark'] as const).flatMap((scheme) =>
    colourKeys.map((key) => ({
      path: `${scheme}.${key}`,
      property: colourAbout[key][0],
      block: scheme === 'light' ? ('root' as const) : ('dark' as const),
      kind: 'colour' as const,
      about: `${colourAbout[key][1]}. ${colourRule(key)}`,
    })),
  ),
  ...lengthTokens('radii', radiusAbout, 'root', (key) =>
    atLeastBefore(radiusAbout, radiusKeys, key),
  ),
  {
    path: 'font',
    property: '--font-sans',
    block: 'root',
    kind: 'font',
    about: `The font: ${fontIds.map((id) => `${id} (${fonts[id].label})`).join(' or ')}.`,
  },
  ...lengthTokens('type', typeAbout, 'comfortable', (key) => {
    const step = typeSteps.find((candidate) => leadingKey(candidate) === key);
    return step === undefined
      ? atLeastBefore(typeAbout, typeSteps.map(sizeKey), key)
      : `Between ${leadingMin(step)} and 2 times --text-${step}.`;
  }),
  ...lengthTokens('density', densityAbout, 'comfortable', (key) =>
    key === 'densityBodyLeading' ? 'Between 1.4 and 2 times --density-body-size.' : '',
  ),
];

/** The paths of every token, for configuration diffs. */
export const tokenPaths = tokenDefinitions.map((token) => token.path) as [string, ...string[]];

/** The value at a token's path, such as `dark.colorAccent`. */
export function tokenValue(tokens: TokenSet, path: string): string | number {
  let value: unknown = tokens;
  for (const key of path.split('.')) {
    value =
      typeof value === 'object' && value !== null && Object.hasOwn(value, key)
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('There is no token at this path.');
  }
  return value;
}
