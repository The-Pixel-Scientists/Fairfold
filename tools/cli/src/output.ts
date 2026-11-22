// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Everything the cli prints goes through one writer, which replaces every
// secret it has read, or been given, before the text leaves the process.

export interface Output {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Hide this value from everything printed from now on. */
  readonly protect: (secret: string) => void;
}

export const REDACTED = '[secret]';

export function redactingOutput(write: {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}): Output {
  const secrets = new Set<string>();
  const clean = (text: string): string => {
    let result = text;
    // Longest first, so a secret that contains another is hidden whole.
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      result = result.replaceAll(secret, REDACTED);
    }
    return result;
  };
  return {
    out: (line) => {
      write.stdout(`${clean(line)}\n`);
    },
    err: (line) => {
      write.stderr(`${clean(line)}\n`);
    },
    protect: (secret) => {
      if (secret !== '') secrets.add(secret);
    },
  };
}
