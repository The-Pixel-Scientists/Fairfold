// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Only this folder imports pg-boss, only sendJob() sends, and no code writes
// to the pgboss schema directly (ADR 0009), until S11-96's Semgrep rules
// take over. Tests of the schema itself, in packages/db/test, are exempt.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as jobs from './index.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;
const IMPORT = /(?:from|import\(|require\()\s*['"]pg-boss['"]/;
const INSERT = /insert\s+into\s+"?pgboss"?\./i;
const SEND = /\.send(?:After|Throttled|Debounced)?\(|\.insert\(/;

/** Source files under `folder`, relative to the root, leaving out installed and built files. */
function sourceFiles(folder: string): string[] {
  return readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`;
    if (!entry.isDirectory()) return SOURCE.test(entry.name) ? [path] : [];
    return ['node_modules', 'dist'].includes(entry.name) ? [] : sourceFiles(path);
  });
}

describe('pg-boss', () => {
  it(
    'is imported, and the pgboss schema written, only by the jobs helpers',
    { timeout: 30_000 },
    () => {
      const found: string[] = [];
      for (const path of ['apps', 'modules', 'packages', 'scripts', 'e2e'].flatMap(sourceFiles)) {
        if (path.startsWith('packages/db/test/')) continue;
        const text = readFileSync(join(ROOT, path), 'utf8');
        const jobs = path.startsWith('packages/db/src/jobs/');
        if (IMPORT.test(text) && !jobs) found.push(`${path} imports pg-boss`);
        if (INSERT.test(text)) found.push(`${path} inserts into pgboss`);
        const sender = path.endsWith('/send.ts') || path.endsWith('.test.ts');
        if (jobs && !sender && SEND.test(text)) found.push(`${path} sends a job`);
      }
      expect(found).toEqual([]);
    },
  );
});

describe('the ./jobs entry', () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8'),
  ) as { exports: Record<string, string> };

  it('is exported as src/jobs/index.ts, with no wider deep path into src', () => {
    expect(manifest.exports['./jobs']).toBe('./src/jobs/index.ts');
    const deep = Object.entries(manifest.exports).filter(
      ([key, target]) => key.includes('*') && !target.startsWith('./src/generated/'),
    );
    expect(deep).toEqual([]);
  });

  it('does not export the internal queueing path', () => {
    expect(Object.keys(jobs)).not.toContain('sendEventJob');
    expect(Object.keys(jobs)).not.toContain('currentTenant');
  });
});
