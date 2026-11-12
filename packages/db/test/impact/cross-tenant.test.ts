// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cross-tenant denial for every impact table (architecture rule 2), and
// each composite foreign key refusing another tenant's membership,
// framework, outcome, indicator, result or file.

import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial, type RowFactory } from '../cross-tenant.ts';
import { addFile } from '../grants/application-fixtures.ts';
import {
  addMember,
  asMigratorIn,
  createTestTenant,
  insertRow,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import {
  addImpactParts,
  evidenceRow,
  frameworkRow,
  indicatorRow,
  insertOutcome,
  noteRow,
  outcomeRow,
  resultRow,
  targetRow,
  type ImpactParts,
} from './fixtures.ts';

// Each factory adds no other row to the table under test, so the blind
// statements meet one row a tenant, and no row another still refers to.
const emptyFramework = async (client: pg.ClientBase, tenant: TestTenant) =>
  insertRow(client, 'impact.framework', frameworkRow(tenant, await addMember(client, tenant)));

const FACTORIES: Readonly<Record<string, RowFactory>> = {
  'impact.framework': async (client, tenant) =>
    frameworkRow(tenant, await addMember(client, tenant)),
  'impact.outcome': async (client, tenant) =>
    outcomeRow(tenant, await emptyFramework(client, tenant)),
  'impact.indicator': async (client, tenant) => {
    const framework = await emptyFramework(client, tenant);
    const outcomeId = await insertRow(client, 'impact.outcome', outcomeRow(tenant, framework));
    return indicatorRow(tenant, framework, outcomeId);
  },
  'impact.target': async (client, tenant) =>
    targetRow(tenant, await addImpactParts(client, tenant)),
  'impact.result': async (client, tenant) =>
    resultRow(tenant, await addImpactParts(client, tenant)),
  'impact.result_evidence': async (client, tenant) => {
    const parts = await addImpactParts(client, tenant);
    const result = await insertRow(client, 'impact.result', resultRow(tenant, parts));
    return evidenceRow(tenant, parts, result, await addFile(client, tenant, parts.member));
  },
  'impact.learning_note': async (client, tenant) =>
    noteRow(tenant, await addImpactParts(client, tenant)),
};

describe('impact cross-tenant denial', { timeout: 120_000 }, () => {
  it.each(Object.keys(FACTORIES))('%s', (table) =>
    expectCrossTenantDenial(table, FACTORIES[table] as RowFactory),
  );
});

describe('impact foreign keys across tenants', { timeout: 60_000 }, () => {
  let a: TestTenant;
  let own: ImpactParts & { result: string; file: string };
  let other: ImpactParts & { result: string; file: string };

  beforeAll(async () => {
    const add = (tenant: TestTenant) =>
      asMigratorIn(tenant.id, async (client) => {
        const parts = await addImpactParts(client, tenant);
        return {
          ...parts,
          result: await insertRow(client, 'impact.result', resultRow(tenant, parts)),
          file: await addFile(client, tenant, parts.member),
        };
      });
    a = await createTestTenant();
    own = await add(a);
    other = await add(await createTestTenant());
  });

  const cases = (): [string, string, Row][] => [
    ['membership', 'impact.framework', frameworkRow(a, other.member)],
    ['framework', 'impact.outcome', outcomeRow(a, other.framework)],
    ['outcome', 'impact.indicator', indicatorRow(a, own.framework, other.outcome)],
    ['indicator', 'impact.target', targetRow(a, { ...own, indicator: other.indicator })],
    ['membership', 'impact.target', targetRow(a, own, { updated_by: other.member })],
    ['indicator', 'impact.result', resultRow(a, { ...own, indicator: other.indicator })],
    ['membership', 'impact.result', resultRow(a, own, { recorded_by: other.member })],
    ['result', 'impact.result_evidence', evidenceRow(a, own, other.result, own.file)],
    ['file', 'impact.result_evidence', evidenceRow(a, own, own.result, other.file)],
    ['framework', 'impact.learning_note', noteRow(a, { ...own, framework: other.framework })],
    ['outcome', 'impact.learning_note', noteRow(a, own, { outcome_id: other.outcome })],
    ['membership', 'impact.learning_note', noteRow(a, own, { created_by: other.member })],
  ];

  it('refuse each reference to another tenant', async () => {
    for (const [kind, table, row] of cases()) {
      expect(await insertOutcome('app_api', a, table, row), `${table} with B's ${kind}`).toBe(
        '23503',
      );
    }
  });
});
