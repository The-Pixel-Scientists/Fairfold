// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cross-tenant denial for every insight table and every role with a grant
// on it (architecture rule 2), and each composite foreign key refusing
// another tenant's membership or file.

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial, type RowFactory } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  insertStatement,
  outcome,
  type TestTenant,
} from '../tenants.ts';
import {
  addInsightParts,
  definitionRow,
  insertOutcome,
  ruleRow,
  runRow,
  type InsightParts,
} from './fixtures.ts';

const FACTORIES: Readonly<Record<string, RowFactory>> = {
  'insight.report_definition': async (client, tenant) =>
    definitionRow(tenant, await addMember(client, tenant)),
  'insight.disclosure_rule': async (client, tenant) =>
    ruleRow(tenant, await addMember(client, tenant)),
  'insight.publication_run': async (client, tenant) =>
    runRow(tenant, await addMember(client, tenant)),
};

describe('insight cross-tenant denial', { timeout: 120_000 }, () => {
  it.each(Object.keys(FACTORIES))('%s', (table) =>
    expectCrossTenantDenial(table, FACTORIES[table] as RowFactory),
  );
});

describe('insight foreign keys across tenants', { timeout: 60_000 }, () => {
  let a: TestTenant;
  let own: InsightParts & { preparing: string; prepared: string };
  let other: InsightParts;

  beforeAll(async () => {
    a = await createTestTenant();
    own = await asMigratorIn(a.id, async (client) => {
      const parts = await addInsightParts(client, a);
      const run = (change = {}) =>
        insertRow(client, 'insight.publication_run', runRow(a, parts.member, change));
      return {
        ...parts,
        preparing: await run(),
        prepared: await run({ state: 'prepared', output_file_id: parts.file }),
      };
    });
    const b = await createTestTenant();
    other = await asMigratorIn(b.id, (client) => addInsightParts(client, b));
  });

  it("refuse another tenant's membership on insert", async () => {
    for (const [table, row] of [
      ['insight.report_definition', definitionRow(a, other.member)],
      ['insight.report_definition', definitionRow(a, own.member, { updated_by: other.member })],
      ['insight.disclosure_rule', ruleRow(a, other.member)],
      ['insight.disclosure_rule', ruleRow(a, own.member, { updated_by: other.member })],
      ['insight.publication_run', runRow(a, other.member)],
    ] as const) {
      expect(await insertOutcome('app_api', a, table, row), table).toBe('23503');
    }
  });

  it("refuse another tenant's file as output, and member as submitter", async () => {
    // The run's trigger refuses a file this tenant cannot see before the
    // foreign key is checked; an insert, which takes no output check, meets
    // the key itself.
    const prepare = await asRoleIn('app_worker', a.id, (client) =>
      outcome(
        client,
        "UPDATE insight.publication_run SET state = 'prepared', output_file_id = $2 WHERE id = $1",
        [own.preparing, other.file],
      ),
    );
    expect(prepare).toBe('55000');
    const inserted = await asMigratorIn(a.id, (client) => {
      const row = runRow(a, own.member, { state: 'prepared', output_file_id: other.file });
      const { text, values } = insertStatement(client, 'insight.publication_run', row);
      return outcome(client, text, values);
    });
    expect(inserted).toBe('23503');
    const submit = await asRoleIn('app_api', a.id, (client) =>
      outcome(
        client,
        "UPDATE insight.publication_run SET state = 'submitted', submitted_by = $2 WHERE id = $1",
        [own.prepared, other.member],
      ),
    );
    expect(submit).toBe('23503');
  });
});
