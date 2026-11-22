// SPDX-License-Identifier: AGPL-3.0-or-later

import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readSecretFile } from './db.ts';

describe('readSecretFile', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  function secretFile(value: string): string {
    const folder = mkdtempSync(join(tmpdir(), 'tps-db-'));
    folders.push(folder);
    const path = join(folder, 'secret');
    writeFileSync(path, value);
    return path;
  }

  it('reads a file by its path', () => {
    expect(readSecretFile(secretFile('by-path'))).toBe('by-path');
  });

  it('reads /dev/fd/N from the descriptor itself, and gives the same value again', () => {
    const descriptor = openSync(secretFile('handed-over'), 'r');
    try {
      const path = `/dev/fd/${String(descriptor)}`;
      expect(readSecretFile(path)).toBe('handed-over');
      // The descriptor is now at its end, as a pipe would be.
      expect(readSecretFile(path)).toBe('handed-over');
    } finally {
      closeSync(descriptor);
    }
  });
});
