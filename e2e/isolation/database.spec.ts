// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Isolation in the database: every tenant table in the catalogue has a
// cross-tenant denial test (architecture rule 2). The catalogue is the field
// classification map, which the schema lint holds equal to the tables the
// database really has, less the tables the lint lists as having no tenant. A
// table with no `expectCrossTenantDenial('<table>', …)` anywhere in the
// repository's tests fails here, by name, so a new table cannot merge without
// its denial test. This reads files only, so it needs no database.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { classification } from '../../packages/db/classification.ts';
import { NON_TENANT_TABLES, TENANT_KEYED_BY_ID } from '../../packages/db/test/schema-lint.ts';
import { repositoryRoot } from '../../scripts/dev-names.ts';
import { expect, test } from '../../scripts/e2e/fixtures.ts';

const ROOTS = ['packages', 'modules', 'apps'];
const SKIPPED = new Set(['node_modules', 'dist', 'generated']);

/** Every test file under the workspace folders. */
function testFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name)) return [];
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The tables named in a denial test, with the first file that tests each. */
function deniedTables(): Map<string, string> {
  const denied = new Map<string, string>();
  for (const file of ROOTS.flatMap((root) => testFiles(join(repositoryRoot, root)))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/expectCrossTenantDenial\(\s*'([a-z_]+\.[a-z_]+)'/g)) {
      const table = match[1] ?? '';
      if (!denied.has(table))
        denied.set(table, relative(repositoryRoot, file).split(sep).join('/'));
    }
  }
  return denied;
}

const tenantTables = Object.keys(classification)
  .filter((table) => !NON_TENANT_TABLES.has(table))
  .sort();

test.describe('isolation in the database', () => {
  test('every tenant table has a cross-tenant denial test', () => {
    const denied = deniedTables();
    const untested = tenantTables.filter((table) => !denied.has(table));
    expect(
      untested,
      `Tenant tables with no expectCrossTenantDenial test: ${untested.join(', ')}`,
    ).toEqual([]);
  });

  test('every denial test is for a table that is in the catalogue', () => {
    const catalogue = new Set(Object.keys(classification));
    const stale = [...deniedTables().keys()].filter((table) => !catalogue.has(table));
    expect(stale, `Denial tests for tables that do not exist: ${stale.join(', ')}`).toEqual([]);
  });

  test('the catalogue holds the funder tables, and the tables with no tenant are few and on the lint’s list', () => {
    expect(tenantTables.length).toBeGreaterThan(25);
    for (const table of [
      'app.tenant',
      'app.audit_event',
      'grants.application',
      'grants.decision',
      'party.party',
    ]) {
      expect(tenantTables, table).toContain(table);
    }
    expect(TENANT_KEYED_BY_ID.has('app.tenant')).toBe(true);
    for (const [table, reason] of NON_TENANT_TABLES) {
      expect(table.startsWith('auth.'), `${table}: ${reason}`).toBe(true);
    }
  });
});
