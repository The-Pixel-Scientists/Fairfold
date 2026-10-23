// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The funder's look as a stylesheet file (ADR 0046): the name and text to
// download, and a chosen file read into tokens or into every problem with it.
// The domain package does the reading and the contrast check; the server
// checks the tokens again when they are saved.

import { checkTokens, defaultTokens, tokenDefinitions } from '@pixel-scientists/domain/platform';
import type { TokenSet } from '@pixel-scientists/domain/platform';
import {
  TOKEN_STYLESHEET_MAX_BYTES,
  parseTokenStylesheet,
  stylesheetMessages,
  tokenStylesheet,
  tokensFromPreset,
} from '@pixel-scientists/domain/platform/settings';
import type { ThemeSettings } from '@pixel-scientists/domain/platform/settings';

export const stylesheetMessage = {
  notCss: 'Choose a file that ends in .css.',
  unreadable: 'We could not read this file. Choose it again.',
} as const;

/** A problem in words, after the line it is on when it has one. */
const withLine = (line: number | null, message: string) =>
  line === null ? message : `Line ${String(line)}: ${message}`;

/**
 * The line of a colour token in a file that has read cleanly, so a failing
 * pair can be pointed at. Both colour blocks use the same names, so the
 * block is told apart by its selector, the dark one's naming the scheme.
 */
function colourLine(text: string, field: string): number | null {
  const property = tokenDefinitions.find((token) => token.path === field)?.property;
  if (property === undefined) return null;
  const dark = field.startsWith('dark.');
  // Comments become spaces, keeping their line breaks, so a name in a comment is not found.
  const source = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  for (const match of source.matchAll(new RegExp(String.raw`(?<![\w-])${property}\s*:`, 'g'))) {
    const open = source.lastIndexOf('{', match.index);
    const selector = source.slice(source.lastIndexOf('}', open) + 1, open);
    if (selector.includes('dark') === dark) return source.slice(0, match.index).split('\n').length;
  }
  return null;
}

export type StylesheetRead =
  { tokens: TokenSet; problems?: never } | { tokens?: never; problems: string[] };

/** The name of the file to download. */
export const stylesheetFileName = (slug: string) => `${slug}-theme.css`;

/** The look the funder has now: its own tokens, or its preset and brand colour. */
export function currentTokens(theme: ThemeSettings): TokenSet {
  if (theme.tokens) return theme.tokens;
  try {
    return tokensFromPreset(theme.brandColour, theme.preset);
  } catch {
    // A colour saved under older rules that no longer passes: start from the standard look.
    return defaultTokens;
  }
}

/** The stylesheet of the funder's current look. */
export const currentStylesheet = (theme: ThemeSettings, tenantName: string): string =>
  tokenStylesheet(currentTokens(theme), { tenantName });

/** Offers text to the browser as a file to save. */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/css' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Reads a chosen file: its tokens, or each problem in words, with its line where it has one. */
export async function readStylesheet(file: File): Promise<StylesheetRead> {
  if (!/\.css$/i.test(file.name)) return { problems: [stylesheetMessage.notCss] };
  // Over the limit, so the file is never read into memory.
  if (file.size > TOKEN_STYLESHEET_MAX_BYTES) return { problems: [stylesheetMessages.tooLarge] };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { problems: [stylesheetMessage.unreadable] };
  }
  const parsed = parseTokenStylesheet(text);
  if (parsed.problems) {
    return {
      problems: parsed.problems.map(({ line, message }) => withLine(line, message)),
    };
  }
  const failing = checkTokens(parsed.tokens);
  return failing.length > 0
    ? { problems: failing.map(({ field, message }) => withLine(colourLine(text, field), message)) }
    : { tokens: parsed.tokens };
}
