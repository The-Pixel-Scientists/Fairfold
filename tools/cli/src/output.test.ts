// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { REDACTED, redactingOutput } from './output.ts';

function capture() {
  const written: string[] = [];
  const output = redactingOutput({
    stdout: (text) => written.push(`out:${text}`),
    stderr: (text) => written.push(`err:${text}`),
  });
  return { output, written };
}

describe('redactingOutput', () => {
  it('hides every protected value on both streams, from then on', () => {
    const { output, written } = capture();
    output.out('before abc123secret');
    output.protect('abc123secret');
    output.protect('');
    output.out('after abc123secret and abc123secret');
    output.err('error: abc123secret');
    expect(written).toEqual([
      'out:before abc123secret\n',
      `out:after ${REDACTED} and ${REDACTED}\n`,
      `err:error: ${REDACTED}\n`,
    ]);
  });

  it('hides a secret that contains another as a whole', () => {
    const { output, written } = capture();
    output.protect('short-secret');
    output.protect('short-secret-and-more');
    output.out('short-secret-and-more');
    expect(written).toEqual([`out:${REDACTED}\n`]);
  });
});
