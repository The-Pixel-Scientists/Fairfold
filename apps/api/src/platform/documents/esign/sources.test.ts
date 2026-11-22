// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Guards over this folder's source (ADR 0040, rules 8 and 9): the callback
// reaches tenant data only through the approved function, and the signature
// code writes to no table outside the signature, file and audit tables.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const folder = import.meta.dirname;
const sources = readdirSync(folder)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({ name, text: readFileSync(join(folder, name), 'utf8') }));
const text = (name: string) => sources.find((source) => source.name === name)?.text ?? '';

/** Code with its comments removed, so a guard reads what runs, not what is explained. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the callback handler', () => {
  const callback = code(text('callback.ts'));

  it('reaches tenant data only through the approved function', () => {
    expect(callback).toContain('app.resolve_signature_callback');
    for (const forbidden of [
      'signature_request',
      'signature_signer',
      'app.tenant',
      'app.file',
      'withTenant',
      'inTenant',
      'set_config',
      'current_tenant',
      'sql`',
    ]) {
      expect(callback, forbidden).not.toContain(forbidden);
    }
  });

  it('is the only file that calls it, and no other file looks a tenant up from a reference', () => {
    for (const { name, text: source } of sources) {
      if (name === 'callback.ts') continue;
      expect(code(source), name).not.toContain('resolve_signature_callback');
      expect(code(source), name).not.toContain('callback_reference_hash');
    }
  });

  it('takes nothing from the body but what the provider schema parses', () => {
    expect(callback).toContain('callbackHintSchema.parse(deps.provider.parseCallback(input.body))');
    expect(callback).not.toMatch(/JSON\.parse|body\.(tenant|status|request)/);
  });
});

describe('the signature jobs and service', () => {
  const allowed = new Set([
    'app.file',
    'app.signature_connection',
    'app.signature_request',
    'app.signature_request_file',
    'app.signature_signer',
  ]);

  it('read and write only the signature, file and audit tables', () => {
    const tables = new Set<string>();
    for (const { text: source } of sources) {
      for (const match of code(source).matchAll(
        /(?:selectFrom|insertInto|updateTable|innerJoin|leftJoin)\(\s*'([a-z_.]+)/g,
      )) {
        tables.add(match[1]?.split(' as ')[0] ?? '');
      }
    }
    expect([...tables].filter((table) => !allowed.has(table))).toEqual([]);
    expect(tables.size).toBeGreaterThan(0);
  });

  it('never update an application, award, decision or payment', () => {
    for (const { name, text: source } of sources) {
      expect(code(source), name).not.toMatch(/grants\.|finance\.|\.decision|\.award|payment/i);
    }
  });

  it('never store an address and never log or keep a provider message', () => {
    for (const { name, text: source } of sources) {
      expect(code(source), name).not.toMatch(/\bemail\b.*\.(set|values)\(|logger|console\./);
    }
  });
});
