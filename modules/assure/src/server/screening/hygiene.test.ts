// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Outbound and brand hygiene for the screening code (ADR 0010, ADR 0031): the
// list is fetched with the client apps/api pins to its host, so no file here
// builds a client, passes a dispatcher, reaches a socket module or reads
// proxy settings. A decision is written in one store function, which only the
// decision handler calls, and no file reaches a party or grants table.

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

describe('the screening folder', () => {
  it('has sources to check', () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  it.each(sources)('%s creates no client and reads no proxy settings', (name) => {
    expect(read(name)).not.toMatch(OUTBOUND);
  });

  it.each(sources)('%s names no brand', (name) => {
    expect(read(name)).not.toMatch(/fairfold|pixel scientists/i);
  });

  it('writes a decision in store.ts only, and only the decision handler calls it', () => {
    const writers = sources.filter((name) => read(name).includes("'assure.match_decision'"));
    expect(writers).toEqual(['store.ts']);
    const callers = sources.filter(
      (name) => name !== 'store.ts' && /\binsertDecision\(/.test(read(name)),
    );
    expect(callers).toEqual(['handlers.ts']);
  });

  it.each(sources)('%s reaches no party or grants table', (name) => {
    expect(read(name)).not.toMatch(
      /(selectFrom|insertInto|updateTable|deleteFrom)\('(party|grants)\./,
    );
  });
});
