// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Outbound hygiene for the registry code (ADR 0010, ADR 0031): every call
// uses the global fetch the dispatcher governs, so no file here builds its
// own client, passes a dispatcher, reaches a socket module or reads proxy
// settings. The adapters import no database, so the lookup widget can use
// them alone.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const folder = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(folder).filter(
  (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
);
const read = (name: string): string => readFileSync(join(folder, name), 'utf8');

const OUTBOUND = /new (Agent|Pool|Client)\(|dispatcher:|node:https?|node:net|node:tls|HTTPS?_PROXY/;
const ADAPTER_FILES = [
  'adapters.ts',
  'charity-commission.ts',
  'companies-house.ts',
  'http.ts',
  'limiter.ts',
  'parse.ts',
  'secret.ts',
  'transport.ts',
];

describe('the registry folder', () => {
  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  it.each(sources)('%s creates no client and reads no proxy settings', (name) => {
    expect(read(name)).not.toMatch(OUTBOUND);
  });

  it.each(ADAPTER_FILES)('%s uses no database, tenant, request or audit writer', (name) => {
    expect(read(name)).not.toMatch(/@pixel-scientists\/db|kysely|\.\/store\.ts|\.\/handlers\.ts/);
  });

  it.each(sources)('%s names no brand', (name) => {
    expect(read(name)).not.toMatch(/fairfold|pixel scientists/i);
  });

  it('builds addresses only from fixed hosts', () => {
    for (const name of ['charity-commission.ts', 'companies-house.ts']) {
      expect(read(name)).toMatch(/const HOST = 'https:\/\//);
    }
  });
});
