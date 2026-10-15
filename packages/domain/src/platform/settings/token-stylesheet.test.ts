// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { productName } from '../brand.ts';
import { defaultTheme, presets } from '../theme.ts';
import { defaultTokens, tokenDefinitions, tokenMessages, type TokenSet } from '../theme-tokens.ts';
import { tokensFromPreset } from './theme-css.ts';
import {
  parseTokenStylesheet,
  stylesheetMessages as says,
  TOKEN_STYLESHEET_MAX_BYTES,
  tokenStylesheet,
  type StylesheetProblem,
} from './token-stylesheet.ts';

const sheet = tokenStylesheet(defaultTokens, { tenantName: 'Northfield Trust' });
const lines = sheet.split('\n');

/** The 1-based line that declares a custom property in a block, after the block's selector. */
function lineOf(property: string, selector = ':root {'): number {
  const start = lines.indexOf(selector);
  return lines.findIndex((line, i) => i > start && line.startsWith(`  ${property}:`)) + 1;
}

/** The default sheet with one line replaced, or more lines put in its place. */
function edited(line: number, ...replacement: string[]): string {
  return [...lines.slice(0, line - 1), ...replacement, ...lines.slice(line)].join('\n');
}

function problems(text: string): StylesheetProblem[] {
  const result = parseTokenStylesheet(text);
  if (result.problems === undefined) throw new Error('Expected the file to be refused.');
  return result.problems;
}

describe('tokenStylesheet', () => {
  it('starts with how to edit and upload the file, and that comments are not kept', () => {
    const header = sheet.slice(0, sheet.indexOf('*/'));
    expect(header).toContain(`The look of Northfield Trust in ${productName}.`);
    expect(header).toContain('upload this file on the Look page');
    expect(header).toContain('Comments are not kept');
  });

  it('writes the three blocks, each token once with a comment above it', () => {
    expect(lines.filter((line) => line.endsWith('{'))).toEqual([
      ':root {',
      ":root[data-scheme='dark'] {",
      "[data-density='comfortable'] {",
    ]);
    for (const token of tokenDefinitions) {
      const selector = {
        root: ':root {',
        dark: ":root[data-scheme='dark'] {",
        comfortable: "[data-density='comfortable'] {",
      }[token.block];
      const line = lineOf(token.property, selector);
      expect(line, token.path).toBeGreaterThan(0);
      expect(lines[line - 2]).toBe(`  /* ${token.about} */`);
    }
    expect(lines).toContain('  --color-ink: #17181b;');
    expect(lines).toContain('  --font-sans: atkinson;');
    expect(lines).toContain('  --text-xs: 0.75rem;');
  });

  it('keeps a tenant name inside its comment', () => {
    const hostile = tokenStylesheet(defaultTokens, { tenantName: 'A */ :root { --x: 1; } /*\nB' });
    expect(hostile.split('\n')[1]).toBe(
      ' * The look of A * / :root { --x: 1; } /* B in Fairfold Grants.',
    );
    expect(parseTokenStylesheet(hostile)).toEqual({ tokens: defaultTokens });
  });
});

describe('parseTokenStylesheet', () => {
  it('reads back the defaults and every preset unchanged', () => {
    const looks: TokenSet[] = [
      defaultTokens,
      ...presets.flatMap((preset) =>
        [defaultTheme.brandColour, '#0b5394', '#7a2e8c'].map((colour) =>
          tokensFromPreset(colour, preset),
        ),
      ),
      { ...defaultTokens, font: 'system' },
    ];
    for (const tokens of looks) {
      const text = tokenStylesheet(tokens, { tenantName: 'Northfield Trust' });
      expect(parseTokenStylesheet(text)).toEqual({ tokens });
    }
  });

  it('accepts either quote style, upper-case hex, a byte order mark and no comments', () => {
    const bare = sheet
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll("'", '"')
      .replace('#17181b', '#17181B');
    expect(parseTokenStylesheet(`\uFEFF${bare}`)).toEqual({ tokens: defaultTokens });
  });

  it('refuses a file over 32 KB before reading it', () => {
    const big = `${sheet}/*${'x'.repeat(TOKEN_STYLESHEET_MAX_BYTES)}*/`;
    expect(problems(big)).toEqual([{ line: null, message: says.tooLarge }]);
    const multibyte = `${sheet}/*${'é'.repeat(TOKEN_STYLESHEET_MAX_BYTES / 2)}*/`;
    expect(problems(multibyte)).toEqual([{ line: null, message: says.tooLarge }]);
  });

  it('refuses each thing outside the format, at its line', () => {
    const ink = lineOf('--color-ink');
    const radius = lineOf('--radius-sm');
    const cases: [text: string, line: number, message: string][] = [
      [edited(1, '@import url(x);', lines[0] ?? ''), 1, says.atRule],
      [edited(ink, '  @import "x";'), ink, says.atRule],
      [edited(ink, '  --color-ink: #17181b !important;'), ink, says.important],
      [edited(ink, '  --color-ink: rgb(0 0 0);'), ink, says.func],
      [edited(ink, '  --color-ink: url(x);'), ink, says.func],
      [edited(ink, '  --color-ink: #17181\\62;'), ink, says.escape],
      [edited(ink, '  --color-\\69nk: #17181b;'), ink, says.escape],
      [edited(ink, '  --color-ink: #17181b'), ink, says.declaration],
      [edited(ink, '  color: #17181b;'), ink, says.declaration],
      [edited(ink, '  --color-ink: #17181b #000000;'), ink, says.declaration],
      [edited(ink, '  --color-ink: red;'), ink, says.colour],
      [edited(radius, '  --radius-sm: 4px;'), radius, says.length],
      [edited(radius, '  --radius-sm: 0.2505rem;'), radius, says.length],
      [edited(lineOf('--font-sans'), '  --font-sans: Arial;'), lineOf('--font-sans'), says.font],
      [edited(ink, '  --color-inky: #17181b;'), ink, says.unknownToken],
      [edited(ink, '  --text-xs: 0.75rem;'), ink, says.unknownToken],
      [edited(ink, '  body { color: red; }'), ink, says.nested],
    ];
    for (const [text, line, message] of cases) {
      expect(problems(text), message).toContainEqual({ line, message });
    }
  });

  it('refuses other selectors, at-rule blocks, repeated blocks and stray braces', () => {
    const end = lines.length;
    const cases: [text: string, line: number, message: string][] = [
      [`${sheet}body { --color-ink: #000000; }\n`, end, says.selector],
      [`${sheet}:root:hover {\n}\n`, end, says.selector],
      [`${sheet}@media print { :root { --color-ink: #000000; } }\n`, end, says.atRule],
      [`${sheet}:root {\n}\n`, end, says.repeatedBlock],
      [`${sheet}}\n`, end, says.strayBrace],
      [`${sheet}--color-ink: #000000;\n`, end, says.outsideBlock],
      [
        sheet.slice(0, sheet.lastIndexOf('}')),
        lines.indexOf("[data-density='comfortable'] {") + 1,
        says.unclosedBlock,
      ],
      [`${sheet}/* never closed\n`, end, says.unclosedComment],
    ];
    for (const [text, line, message] of cases) {
      expect(problems(text), message).toContainEqual({ line, message });
    }
  });

  it('refuses a repeated or missing token, and a missing block', () => {
    const ink = lineOf('--color-ink');
    const repeated = edited(ink, '  --color-ink: #17181b;', '  --color-ink: #000000;');
    expect(problems(repeated)).toEqual([
      { line: ink + 1, message: says.repeatedToken('--color-ink') },
    ]);
    const close = lines.indexOf('}', ink) + 1;
    expect(problems(edited(ink))).toEqual([
      { line: close - 1, message: says.missingToken('--color-ink') },
    ]);
    const dark = lines.indexOf(":root[data-scheme='dark'] {");
    const darkEnd = lines.indexOf('}', dark);
    const noDark = [...lines.slice(0, dark), ...lines.slice(darkEnd + 1)].join('\n');
    expect(problems(noDark)).toEqual([
      { line: null, message: says.missingBlock(":root[data-scheme='dark']") },
    ]);
  });

  it('lists every problem, in line order', () => {
    const ink = lineOf('--color-ink');
    const radius = lineOf('--radius-sm');
    const text = edited(radius, '  --radius-sm: 4px;').split('\n');
    text[ink - 1] = '  --color-ink: red !important;';
    expect(problems(text.join('\n'))).toEqual([
      { line: ink, message: says.important },
      { line: radius, message: says.length },
    ]);
  });

  it('checks the bounds once the format is right, at the line of the token', () => {
    const md = lineOf('--radius-md');
    expect(problems(edited(md, '  --radius-md: 0.125rem;'))).toEqual([
      { line: md, message: tokenMessages.order('--radius-sm', '--radius-md') },
    ]);
    const gap = lineOf('--density-field-gap', "[data-density='comfortable'] {");
    expect(problems(edited(gap, '  --density-field-gap: 9rem;'))).toEqual([
      { line: gap, message: tokenMessages.length(0.25, 3) },
    ]);
  });

  it('leaves contrast to checkTokens()', () => {
    const muted = lineOf('--color-muted');
    const result = parseTokenStylesheet(edited(muted, '  --color-muted: #999999;'));
    expect(result.tokens?.light.colorMuted).toBe('#999999');
  });
});
