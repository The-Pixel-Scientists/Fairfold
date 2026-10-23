// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkTokens, defaultTokens } from '@pixel-scientists/domain/platform';
import type { ThemeSettings } from '@pixel-scientists/domain/platform/settings';
import {
  stylesheetMessages,
  tokenStylesheet,
  tokensFromPreset,
} from '@pixel-scientists/domain/platform/settings';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  currentStylesheet,
  currentTokens,
  downloadText,
  readStylesheet,
  stylesheetFileName,
  stylesheetMessage,
} from './stylesheet.ts';
import { file, greenTokens } from './testing.ts';

const look = (change: Partial<ThemeSettings> = {}): ThemeSettings => ({
  brandColour: '#1f4bb8',
  preset: 'standard',
  hasLogo: false,
  ...change,
});
const css = (text: string, name = 'northfield-theme.css') => file(text, name, 'text/css');
const sheet = (tokens = greenTokens()) => tokenStylesheet(tokens, { tenantName: 'Northfield' });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the stylesheet of the current look', () => {
  it('is named for the funder', () => {
    expect(stylesheetFileName('northfield')).toBe('northfield-theme.css');
  });

  it('comes from the preset and brand colour while there are no tokens of its own', () => {
    const rounded = look({ brandColour: '#0b5d3b', preset: 'rounded' });

    expect(currentTokens(rounded)).toEqual(tokensFromPreset('#0b5d3b', 'rounded'));
    expect(currentStylesheet(rounded, 'Northfield')).toBe(
      tokenStylesheet(tokensFromPreset('#0b5d3b', 'rounded'), { tenantName: 'Northfield' }),
    );
  });

  it('comes from the saved tokens when there are some', () => {
    expect(currentTokens(look({ tokens: greenTokens() }))).toEqual(greenTokens());
  });

  it('starts from the standard look when the saved colour no longer passes', () => {
    expect(currentTokens(look({ brandColour: '#ffee00' }))).toBe(defaultTokens);
  });
});

describe('downloading', () => {
  it('offers the text as a file with the name given, and lets the address go', () => {
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('northfield-theme.css');
      expect(this.href).toBe('blob:test');
    });

    downloadText('northfield-theme.css', 'a {}');

    expect(click).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});

describe('reading a chosen file', () => {
  it('reads a downloaded stylesheet back into the same tokens', async () => {
    expect(await readStylesheet(css(sheet()))).toEqual({ tokens: greenTokens() });
  });

  it('refuses a file that does not end in .css, without reading it', async () => {
    expect(await readStylesheet(css(sheet(), 'theme.txt'))).toEqual({
      problems: [stylesheetMessage.notCss],
    });
  });

  it('refuses a file over 32 KB without reading it', async () => {
    const big = css('a'.repeat(32 * 1024 + 1));
    const read = vi.spyOn(big, 'text');

    expect(await readStylesheet(big)).toEqual({ problems: [stylesheetMessages.tooLarge] });
    expect(read).not.toHaveBeenCalled();
  });

  it('says when the file cannot be read', async () => {
    const broken = css('');
    vi.spyOn(broken, 'text').mockRejectedValue(new Error('denied'));

    expect(await readStylesheet(broken)).toEqual({ problems: [stylesheetMessage.unreadable] });
  });

  it('lists every problem with its line', async () => {
    const lines = sheet().split('\n');
    const ink = lines.findIndex((line) => line.includes('--color-ink:'));
    const accent = lines.findIndex((line) => line.includes('--color-accent:'));
    lines[ink] = '  --color-ink: #17181b !important;';
    lines[accent] = '  --color-accent: blue;';

    const read = await readStylesheet(css(lines.join('\n')));

    expect(read.problems).toEqual([
      `Line ${String(ink + 1)}: ${stylesheetMessages.important}`,
      `Line ${String(accent + 1)}: ${stylesheetMessages.colour}`,
    ]);
  });

  it('lists a problem with the whole file without a line', async () => {
    const read = await readStylesheet(css('/* nothing here */'));

    expect(read.problems?.[0]).toMatch(/^Add the :root block back/);
    expect(read.problems?.every((problem) => !problem.startsWith('Line'))).toBe(true);
  });

  it('lists each failing contrast pair from the check, when the file reads cleanly', async () => {
    const bad = { ...greenTokens(), light: { ...greenTokens().light, colorMuted: '#eeeeee' } };

    const text = sheet(bad);

    const read = await readStylesheet(css(text));

    const failing = checkTokens(bad);
    expect(failing.length).toBeGreaterThan(0);
    // Every failing pair is pointed at the light muted colour's line.
    const line = text.split('\n').findIndex((row) => row.includes('--color-muted:')) + 1;
    expect(read.problems).toEqual(failing.map(({ message }) => `Line ${String(line)}: ${message}`));
  });
});
