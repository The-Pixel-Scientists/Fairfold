// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A funder's look as a commented stylesheet to download, edit and upload
// (ADR 0046). The browser reads the file with parseTokenStylesheet() and
// sends the tokens, never the file; the server checks the tokens again and
// never parses CSS. The format is strict: comments, the three blocks, and a
// declaration of each known token, once.

import { productName } from '../brand.ts';
import { fieldForIssue, messageForIssue, messages } from '../messages.ts';
import {
  fonts,
  remText,
  tokenDefinitions,
  tokenSetSchema,
  tokenValue,
  type TokenBlock,
  type TokenDefinition,
  type TokenSet,
} from '../theme-tokens.ts';
import { COMFORTABLE_SELECTOR, DARK_SCHEME_SELECTOR } from './theme-css.ts';

export const TOKEN_STYLESHEET_MAX_BYTES = 32 * 1024;

const blocks: Record<TokenBlock, { selector: string; about: string }> = {
  root: { selector: ':root', about: 'Light colours, corners and the font, in both apps.' },
  dark: {
    selector: DARK_SCHEME_SELECTOR,
    about: 'Dark colours, in both apps when someone chooses the dark scheme.',
  },
  comfortable: {
    selector: COMFORTABLE_SELECTOR,
    about: 'Text sizes and spacing, in the portal only. The console keeps its compact sizes.',
  },
};

const blockNames = Object.keys(blocks) as TokenBlock[];

/** One thing to fix in an uploaded file, and its line, or null for the whole file. */
export interface StylesheetProblem {
  line: number | null;
  message: string;
}

export const stylesheetMessages = {
  tooLarge: 'Upload a file of 32 KB or less.',
  unclosedComment: 'Close this comment with */.',
  atRule: 'Remove this @ rule. The file holds only the three blocks it was downloaded with.',
  selector: `Use only the three blocks the file was downloaded with: ${blockNames.map((name) => blocks[name].selector).join(', ')}.`,
  repeatedBlock: 'Remove this block. Each block appears once.',
  missingBlock: (selector: string) => `Add the ${selector} block back, with every token in it.`,
  unclosedBlock: 'Close this block with }.',
  strayBrace: 'Remove this }. It closes no block.',
  nested: 'Remove this nested block. A block holds only token declarations.',
  declaration: 'Write each line as a token, its value and a semicolon, like --color-ink: #17181b;',
  outsideBlock: 'Move this into one of the three blocks.',
  escape: 'Remove the backslash. The file cannot use escapes.',
  important: 'Remove !important. Every token applies as it is.',
  func: 'Use a plain value, not a function such as url() or var().',
  unknownToken: 'This block has no token of this name. Check the name against the downloaded file.',
  repeatedToken: (property: string) => `Remove the second ${property}. Each token appears once.`,
  missingToken: (property: string) => `Add ${property} to this block.`,
  colour: messages.brandColourFormat,
  length: 'Enter a length in rem, like 1.125rem, with up to three decimal places, or 0.',
  font: `Enter ${Object.keys(fonts).join(' or ')}.`,
} as const;

/** Text in a comment, which cannot end the comment or start a new line. */
function commentText(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replaceAll('*/', '* /');
}

const text = (value: string | number) => (typeof value === 'string' ? value : remText(value));

/** The commented stylesheet of a look, in three blocks. */
export function tokenStylesheet(tokens: TokenSet, { tenantName }: { tenantName: string }): string {
  const header = [
    '/*',
    ` * The look of ${commentText(tenantName)} in ${productName}.`,
    ' *',
    ' * To change it, edit the values below, then upload this file on the Look page',
    ' * in Settings. Change values only: keep every token once, in its own block,',
    ' * and add no other rules. Colours are hex codes like #1f4bb8. Lengths are rem,',
    ' * like 1.125rem, or 0. Every value and every contrast pair is checked when you',
    ' * upload, and the Look page lists any problem with its line.',
    ' *',
    ' * Comments are not kept: the next download is written afresh from the saved look.',
    ' */',
  ];
  const body = blockNames.flatMap((name) => [
    '',
    `/* ${blocks[name].about} */`,
    `${blocks[name].selector} {`,
    ...tokenDefinitions
      .filter((token) => token.block === name)
      .flatMap((token) => [
        `  /* ${token.about} */`,
        `  ${token.property}: ${text(tokenValue(tokens, token.path))};`,
      ]),
    '}',
  ]);
  return `${[...header, ...body].join('\n')}\n`;
}

const SELECTORS: [RegExp, TokenBlock][] = [
  [/^:root$/, 'root'],
  [/^:root\[data-scheme=(['"])dark\1\]$/, 'dark'],
  [/^\[data-density=(['"])comfortable\1\]$/, 'comfortable'],
];

/** Each kind of value as the file writes it, read into its stored form, or undefined. */
const readers: Record<TokenDefinition['kind'], (text: string) => string | number | undefined> = {
  colour: (text) => (/^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : undefined),
  length: (text) =>
    /^(?:0|\d{1,2}(?:\.\d{1,3})?rem)$/.test(text) ? Number.parseFloat(text) : undefined,
  font: (text) => (Object.hasOwn(fonts, text) ? text : undefined),
};

/** A token set read from the file, or every problem with its line. */
export type StylesheetResult =
  { tokens: TokenSet; problems?: never } | { tokens?: never; problems: StylesheetProblem[] };

/**
 * Reads a token stylesheet. Checks the grammar, then each value's format and
 * the schema's bounds; the caller runs checkTokens() for contrast.
 */
export function parseTokenStylesheet(text: string): StylesheetResult {
  if (utf8Length(text) > TOKEN_STYLESHEET_MAX_BYTES) {
    return { problems: [{ line: null, message: stylesheetMessages.tooLarge }] };
  }
  const problems: StylesheetProblem[] = [];
  const breaks = [...text.matchAll(/\n/g)].map((match) => match.index);
  /** 1 plus the number of line breaks before the index. */
  const lineAt = (index: number) => {
    let [low, high] = [0, breaks.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((breaks[middle] ?? 0) < index) low = middle + 1;
      else high = middle;
    }
    return low + 1;
  };
  const problem = (index: number, message: string) => {
    problems.push({ line: lineAt(index), message });
  };

  // Comments become spaces, keeping line breaks, so every index still points at its line.
  let source = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const unclosed = source.indexOf('/*');
  if (unclosed !== -1) {
    problem(unclosed, stylesheetMessages.unclosedComment);
    source = source.slice(0, unclosed);
  }
  source = source.replace(/^\uFEFF/, ' ');

  /** The next `{`, `}` or `;` from an index, and the trimmed text before it with where it starts. */
  const next = (from: number) => {
    const found = source.slice(from).search(/[{};]/);
    const at = found === -1 ? source.length : from + found;
    const before = source.slice(from, at);
    return { at, char: source[at], text: before.trim(), start: from + before.search(/\S|$/) };
  };

  const values = new Map<string, string | number>();
  const lines = new Map<string, number>();
  const seen = new Set<TokenBlock>();
  let at = 0;
  while (at < source.length) {
    const { at: stop, char, text: selector, start } = next(at);
    at = stop + 1;
    if (char === '{') {
      const block = SELECTORS.find(([pattern]) => pattern.test(selector))?.[1];
      if (selector.startsWith('@')) problem(start, stylesheetMessages.atRule);
      else if (block === undefined) problem(start, stylesheetMessages.selector);
      else if (seen.has(block)) problem(start, stylesheetMessages.repeatedBlock);
      else {
        seen.add(block);
        at = readBlock(block, start, at);
        continue;
      }
      at = skipBlock(source, stop);
    } else if (char === '}') problem(stop, stylesheetMessages.strayBrace);
    else if (selector.startsWith('@')) problem(start, stylesheetMessages.atRule);
    else if (selector !== '') problem(start, stylesheetMessages.outsideBlock);
  }

  /** Reads a block's declarations from `from`, and returns the index after its `}`. */
  function readBlock(block: TokenBlock, open: number, from: number): number {
    const known = tokenDefinitions.filter((token) => token.block === block);
    let index = from;
    for (;;) {
      const { at: stop, char, text: declaration, start } = next(index);
      index = stop + 1;
      if (char === '{') {
        problem(start, stylesheetMessages.nested);
        index = skipBlock(source, stop);
        continue;
      }
      if (declaration !== '') readDeclaration(known, declaration, start, char !== ';');
      if (char === undefined) {
        problem(open, stylesheetMessages.unclosedBlock);
        return index;
      }
      if (char === '}') {
        for (const token of known) {
          if (!values.has(token.path))
            problem(stop, stylesheetMessages.missingToken(token.property));
        }
        return index;
      }
    }
  }

  function readDeclaration(
    known: TokenDefinition[],
    declaration: string,
    start: number,
    unended: boolean,
  ) {
    const name = /^(--[a-z0-9-]+)\s*:/.exec(declaration)?.[1];
    const token = known.find((candidate) => candidate.property === name);
    if (token !== undefined && values.has(token.path)) {
      problem(start, stylesheetMessages.repeatedToken(token.property));
      return;
    }
    // A known token counts as present even if its line has a problem, so it is not also missing.
    if (token !== undefined) values.set(token.path, '');
    const message = declarationProblem(declaration, unended);
    if (message !== undefined) problem(start, message);
    else if (token === undefined) problem(start, stylesheetMessages.unknownToken);
    else {
      const read = readers[token.kind](declaration.slice(declaration.indexOf(':') + 1).trim());
      if (read === undefined) problem(start, stylesheetMessages[token.kind]);
      else values.set(token.path, read);
      lines.set(token.path, lineAt(start));
    }
  }

  for (const name of blockNames) {
    if (!seen.has(name)) {
      problems.push({
        line: null,
        message: stylesheetMessages.missingBlock(blocks[name].selector),
      });
    }
  }
  if (problems.length > 0) return { problems: sorted(problems) };

  const parsed = tokenSetSchema.safeParse(assemble(values));
  if (parsed.success) return { tokens: parsed.data };
  return {
    problems: sorted(
      parsed.error.issues.map((issue) => ({
        line: lines.get(fieldForIssue('', issue).slice(1)) ?? null,
        message: messageForIssue(issue),
      })),
    ),
  };
}

/** The file's size in UTF-8, stopping once it is over the limit. */
function utf8Length(text: string): number {
  if (text.length > TOKEN_STYLESHEET_MAX_BYTES) return text.length;
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function declarationProblem(declaration: string, unended: boolean): string | undefined {
  if (declaration.includes('\\')) return stylesheetMessages.escape;
  if (declaration.includes('@')) return stylesheetMessages.atRule;
  if (/!\s*important/i.test(declaration)) return stylesheetMessages.important;
  if (declaration.includes('(')) return stylesheetMessages.func;
  if (unended || !/^--[a-z0-9-]+\s*:\s*\S+$/.test(declaration)) {
    return stylesheetMessages.declaration;
  }
  return undefined;
}

/** The index after the block opened at `open`, counting nested blocks. */
function skipBlock(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return i + 1;
  }
  return source.length;
}

function assemble(values: Map<string, string | number>): unknown {
  const tokens: Record<string, unknown> = {};
  for (const [path, value] of values) {
    const [group = '', key] = path.split('.');
    if (key === undefined) tokens[group] = value;
    else tokens[group] = { ...(tokens[group] as object | undefined), [key]: value };
  }
  return tokens;
}

function sorted(problems: StylesheetProblem[]): StylesheetProblem[] {
  return problems.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}
