// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Ask for a secret on standard input without echoing it. At a terminal the
// keys are read in raw mode and nothing is shown; from a pipe the first line
// is read, so `tps roles < file` works too.

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export type Prompt = (question: string) => Promise<string>;

/** Standard input, or a stand-in for it. */
export type PromptInput = Readable & { isTTY?: boolean; setRawMode?: (raw: boolean) => unknown };

const ENTER = new Set(['\r', '\n']);
const BACKSPACE = new Set(['\u007f', '\b']);
const INTERRUPT = '\u0003';

export const createPrompt =
  (input: PromptInput, output: { write: (text: string) => unknown }): Prompt =>
  (question) => {
    output.write(question);
    const { setRawMode } = input;
    if (!input.isTTY || setRawMode === undefined) {
      const lines = createInterface({ input, terminal: false });
      return new Promise((resolve) => {
        let answered = false;
        lines.once('line', (line) => {
          answered = true;
          lines.close();
          resolve(line);
        });
        lines.once('close', () => {
          if (!answered) resolve('');
        });
      });
    }
    return new Promise((resolve, reject) => {
      let value = '';
      const finish = (error?: Error) => {
        setRawMode.call(input, false);
        input.pause();
        input.off('data', onData);
        output.write('\n');
        if (error) reject(error);
        else resolve(value);
      };
      const onData = (chunk: Buffer) => {
        for (const key of chunk.toString('utf8')) {
          if (ENTER.has(key)) {
            finish();
            return;
          }
          if (key === INTERRUPT) {
            finish(new Error('Stopped at the prompt. Nothing was changed.'));
            return;
          }
          value = BACKSPACE.has(key) ? value.slice(0, -1) : value + key;
        }
      };
      setRawMode.call(input, true);
      input.resume();
      input.on('data', onData);
    });
  };

export const promptSecret: Prompt = createPrompt(process.stdin, process.stderr);
