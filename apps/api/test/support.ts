// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Helpers for the API's tests.

import { Writable } from 'node:stream';

export type LogLine = Record<string, unknown> & { level: string; msg?: string };

/** A log destination that keeps what is written, so a test can read the lines. */
export function captureLogs(): { stream: Writable; lines: () => LogLine[]; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const text = (): string => chunks.join('');
  return {
    stream,
    text,
    lines: () =>
      text()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as LogLine),
  };
}
