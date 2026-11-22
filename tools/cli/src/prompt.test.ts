// SPDX-License-Identifier: AGPL-3.0-or-later

import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createPrompt } from './prompt.ts';

function terminal() {
  const raw: boolean[] = [];
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (mode: boolean) => raw.push(mode),
  });
  const shown: string[] = [];
  return { input, raw, shown, prompt: createPrompt(input, { write: (text) => shown.push(text) }) };
}

describe('the secret prompt', () => {
  it('reads keys in raw mode at a terminal and shows none of them', async () => {
    const { input, raw, shown, prompt } = terminal();
    const answer = prompt('Password: ');
    input.write('hunter22');
    input.write('x\u007f\r');
    expect(await answer).toBe('hunter22');
    expect(shown).toEqual(['Password: ', '\n']);
    expect(raw).toEqual([true, false]);
  });

  it('stops on Ctrl+C and leaves raw mode', async () => {
    const { input, raw, prompt } = terminal();
    const answer = prompt('Password: ');
    input.write('abc\u0003');
    await expect(answer).rejects.toThrow('Stopped at the prompt. Nothing was changed.');
    expect(raw).toEqual([true, false]);
  });

  it('reads the first line from a pipe, or nothing', async () => {
    const piped = new PassThrough();
    const answer = createPrompt(piped, { write: () => undefined })('Password: ');
    piped.end('from-a-file\nsecond line\n');
    expect(await answer).toBe('from-a-file');

    const empty = new PassThrough();
    const none = createPrompt(empty, { write: () => undefined })('Password: ');
    empty.end();
    expect(await none).toBe('');
  });
});
