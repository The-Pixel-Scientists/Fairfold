// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0024 pastes pg-boss's construction plan rather than generating
// it at migrate time (ADR 0009). This regenerates the plan from the
// installed package and fails if the pasted block differs, so a pg-boss
// upgrade cannot land without a migration. The block leaves out only the
// plan's BEGIN and COMMIT, which the migrator's own transaction replaces,
// and trailing spaces.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getConstructionPlans } from 'pg-boss';
import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../../scripts/migrations.ts';

const START = '-- pg-boss construction plan: start';
const END = '-- pg-boss construction plan: end';

/** `text` split into lines without trailing spaces, and without blank lines at either end. */
function lines(text: string): string[] {
  const all = text.split('\n').map((line) => line.trimEnd());
  while (all[0] === '') all.shift();
  while (all.at(-1) === '') all.pop();
  return all;
}

describe('the pgboss construction plan in migration 0024', () => {
  it('is the installed pg-boss plan, without its BEGIN and COMMIT', async () => {
    const plan = lines(getConstructionPlans('pgboss'));
    expect(plan[0]?.trim()).toBe('BEGIN;');
    expect(plan.at(-1)?.trim()).toBe('COMMIT;');

    const migration = await readFile(join(MIGRATIONS_FOLDER, '0024_app_jobs', 'up.sql'), 'utf8');
    const start = migration.indexOf(START);
    const end = migration.indexOf(END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const pasted = lines(migration.slice(start + START.length, end));

    expect(pasted).toEqual(plan.slice(1, -1));
  });

  it('names the schema version the migration header gives', async () => {
    const migration = await readFile(join(MIGRATIONS_FOLDER, '0024_app_jobs', 'up.sql'), 'utf8');
    expect(getConstructionPlans('pgboss')).toContain(
      "INSERT INTO pgboss.version(version) VALUES ('43');",
    );
    expect(migration).toContain('pg-boss 12.35.0,\n-- schema version 43');
  });
});
