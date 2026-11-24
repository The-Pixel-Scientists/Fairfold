// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Report runs (migration 0111, ADR 0032): denied across tenants as every app
// role with a grant; a run is of its report's kind and current version, by a
// member of the tenant; a warehouse run keeps no figure; a monitoring run
// applies the tenant's disclosure rule as it is now, and only a shown table
// keeps its rounds, population and suppressed cells, with no count from 1
// to below the threshold, no count behind a suppressed cell and no number
// anywhere but a cell's count; and runs are append-only, read by app_api
// alone.

import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { expectCrossTenantDenial } from '../cross-tenant.ts';
import {
  addMember,
  asMigratorIn,
  asRoleIn,
  createTestTenant,
  insertRow,
  outcome,
  type Row,
  type TestTenant,
} from '../tenants.ts';
import { definitionRow, insertOutcome, ruleRow } from './fixtures.ts';

const TABLE = 'insight.report_run';

interface Parts {
  readonly member: string;
  readonly warehouse: string;
  readonly monitoring: string;
}

async function addParts(tenant: TestTenant): Promise<Parts> {
  return asMigratorIn(tenant.id, async (client) => {
    const member = await addMember(client, tenant, ['tenant_admin']);
    const report = (kind: string) =>
      insertRow(client, 'insight.report_definition', definitionRow(tenant, member, { kind }));
    return { member, warehouse: await report('warehouse'), monitoring: await report('monitoring') };
  });
}

const shown = (count: number) => ({ suppressed: false, count });
const hidden = { suppressed: true };

/** A table with one shown row of `count`, two suppressed rows, and a shown total of `total`. */
const table = (count = 12, total = 25): Row => ({
  columns: [],
  rows: [
    { option: 'yes', cells: [], total: shown(count) },
    { option: 'no', cells: [], total: hidden },
    { option: 'prefer_not_to_say', cells: [], total: hidden },
  ],
  totals: { cells: [], total: shown(total) },
});

const warehouseRow = (tenant: TestTenant, parts: Parts, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  report_id: parts.warehouse,
  report_version: 1,
  kind: 'warehouse',
  outcome: 'shown',
  created_by: parts.member,
  updated_by: parts.member,
  ...change,
});

const monitoringRow = (tenant: TestTenant, parts: Parts, change: Row = {}): Row => ({
  tenant_id: tenant.id,
  report_id: parts.monitoring,
  report_version: 1,
  kind: 'monitoring',
  outcome: 'shown',
  question: 'ethnicity',
  filter_field: 'round',
  filter_id: randomUUID(),
  round_ids: [randomUUID()],
  population: 25,
  shown_table: JSON.stringify(table()),
  created_by: parts.member,
  updated_by: parts.member,
  ...change,
});

let tenant: TestTenant;
let parts: Parts;
let stranger: Parts;
beforeAll(async () => {
  tenant = await createTestTenant();
  parts = await addParts(tenant);
  stranger = await addParts(await createTestTenant());
}, 60_000);

const insert = (row: Row, into: TestTenant = tenant) => insertOutcome('app_api', into, TABLE, row);
const monitoring = (change: Row) => insert(monitoringRow(tenant, parts, change));

describe(TABLE, { timeout: 60_000 }, () => {
  it('is denied across tenants', () =>
    expectCrossTenantDenial(TABLE, async (client, rowTenant) => {
      const member = await addMember(client, rowTenant, ['tenant_admin']);
      const report = await insertRow(
        client,
        'insight.report_definition',
        definitionRow(rowTenant, member),
      );
      return warehouseRow(rowTenant, { member, warehouse: report, monitoring: report });
    }));

  it("refuses another tenant's report or member, and a report of the other kind", async () => {
    expect(await insert(warehouseRow(tenant, { ...parts, warehouse: stranger.warehouse }))).toBe(
      '23503',
    );
    expect(await insert(warehouseRow(tenant, { ...parts, member: stranger.member }))).toBe('23503');
    expect(await insert(warehouseRow(tenant, { ...parts, warehouse: parts.monitoring }))).toBe(
      '23503',
    );
  });

  it("is of its report's current version, and never of an archived report", async () => {
    expect(await insert(warehouseRow(tenant, parts))).toBe('ok');
    expect(await insert(warehouseRow(tenant, parts, { report_version: 2 }))).toBe('55000');
    const archived = await asMigratorIn(tenant.id, async (client) => {
      const id = await insertRow(
        client,
        'insight.report_definition',
        definitionRow(tenant, parts.member),
      );
      await client.query('UPDATE insight.report_definition SET archived_at = now() WHERE id = $1', [
        id,
      ]);
      return id;
    });
    expect(await insert(warehouseRow(tenant, { ...parts, warehouse: archived }))).toBe('55000');
  });

  it('keeps no figure, filter or rule for a warehouse run', async () => {
    for (const change of [
      { outcome: 'withheld' },
      { population: 25 },
      { shown_table: JSON.stringify(table()) },
      { round_ids: [randomUUID()] },
      { question: 'ethnicity' },
      { disclosure_rule_version: 1 },
      { filter_field: 'round', filter_id: randomUUID() },
    ]) {
      expect(await insert(warehouseRow(tenant, parts, change)), JSON.stringify(change)).toBe(
        '23514',
      );
    }
  });

  it('keeps the rounds, population and table of a shown monitoring table only', async () => {
    expect(await monitoring({})).toBe('ok');
    expect(await monitoring({ question: null })).toBe('23514');
    for (const column of ['round_ids', 'population', 'shown_table']) {
      expect(await monitoring({ [column]: null }), column).toBe('23514');
    }
    const kept = { round_ids: null, population: null, shown_table: null };
    expect(await monitoring({ ...kept, outcome: 'withheld' })).toBe('ok');
    expect(await monitoring({ ...kept, outcome: 'refused' })).toBe('ok');
    expect(await monitoring({ ...kept, outcome: 'withheld', population: 25 })).toBe('23514');
    expect(await monitoring({ ...kept, outcome: 'refused', round_ids: [randomUUID()] })).toBe(
      '23514',
    );
    expect(await monitoring({ round_ids: [] })).toBe('23514');
    expect(await monitoring({ round_ids: [randomUUID(), null] })).toBe('23514');
  });

  it('holds a filter from the list, with only the value its field takes', async () => {
    const programme = { filter_field: 'programme', filter_id: randomUUID() };
    const year = { filter_field: 'financial_year', filter_id: null, filter_year: 2026 };
    const none = { filter_field: null, filter_id: null };
    expect(await monitoring(programme)).toBe('ok');
    expect(await monitoring(year)).toBe('ok');
    expect(await monitoring(none)).toBe('ok');
    expect(await monitoring({ ...programme, filter_year: 2026 })).toBe('23514');
    expect(await monitoring({ ...year, filter_year: null })).toBe('23514');
    expect(await monitoring({ ...none, filter_year: 2026 })).toBe('23514');
    expect(await monitoring({ filter_field: 'region' })).toBe('23514');
    expect(await monitoring({ ...year, filter_year: 1999 })).toBe('23514');
    expect(await monitoring({ breakdown: 'stage_reached' })).toBe('ok');
    expect(await monitoring({ breakdown: 'answer' })).toBe('23514');
    expect(await monitoring({ question: 'Ethnicity' })).toBe('23514');
  });

  it('never keeps a count the platform floor would hide, or one behind a marker', async () => {
    const stored = (value: unknown) => monitoring({ shown_table: JSON.stringify(value) });
    const withRow = (row: unknown) => {
      const base = table();
      return { ...base, rows: [...(base.rows as unknown[]), row] };
    };
    expect(await stored(table(0))).toBe('ok');
    expect(await monitoring({ population: 19 })).toBe('23514');
    for (const count of [1, 9, -1, 10.5]) {
      expect(await stored(table(count)), String(count)).toBe('23514');
    }
    expect(
      await stored(withRow({ option: 'other', cells: [], total: { suppressed: true, count: 12 } })),
    ).toBe('23514');
    expect(await stored(withRow({ option: 'other', cells: [], total: { count: 12 } }))).toBe(
      '23514',
    );
    expect(await stored(withRow({ option: 'other', cells: [], total: { suppressed: 'no' } }))).toBe(
      '23514',
    );
    expect(await stored(withRow({ option: 'other', cells: [], total: hidden, raw: 3 }))).toBe(
      '23514',
    );
    expect(await stored({ ...table(), columns: [3] })).toBe('23514');
    expect(await stored({ ...table(), respondents: 25 })).toBe('23514');
    expect(await stored(['not', 'an', 'object'])).toBe('23514');
  });

  it("applies the tenant's disclosure rule as it is now", async () => {
    const own = await createTestTenant();
    const ownParts = await addParts(own);
    const row = (change: Row) => insert(monitoringRow(own, ownParts, change), own);
    expect(await row({})).toBe('ok');
    await asMigratorIn(own.id, (client) =>
      insertRow(
        client,
        'insight.disclosure_rule',
        ruleRow(own, ownParts.member, { threshold: 12, minimum_group: 30 }),
      ),
    );
    const ruled = { disclosure_rule_version: 1, population: 30 };
    expect(await row({})).toBe('23514');
    expect(await row({ ...ruled, shown_table: JSON.stringify(table(12, 30)) })).toBe('ok');
    expect(await row({ ...ruled, disclosure_rule_version: 2 })).toBe('23514');
    expect(await row({ ...ruled, population: 29 })).toBe('23514');
    expect(await row({ ...ruled, shown_table: JSON.stringify(table(11, 30)) })).toBe('23514');
    const withheld = { round_ids: null, population: null, shown_table: null, outcome: 'withheld' };
    expect(await row({ ...withheld, disclosure_rule_version: 1 })).toBe('ok');
    expect(await row(withheld)).toBe('23514');
  });

  it('takes its times from the database, and no app role sets them', async () => {
    const past = '2000-01-01T00:00:00Z';
    expect(await insert(warehouseRow(tenant, parts, { created_at: past }))).toBe('42501');
    const times = await asMigratorIn(tenant.id, async (client) => {
      const id = await insertRow(
        client,
        TABLE,
        warehouseRow(tenant, parts, { created_at: past, updated_at: past }),
      );
      const { rows } = await client.query<{ created_at: Date; updated_at: Date }>(
        `SELECT created_at, updated_at FROM ${TABLE} WHERE id = $1`,
        [id],
      );
      return rows[0];
    });
    expect(times?.created_at.getFullYear()).toBeGreaterThan(2000);
    expect(times?.updated_at.getFullYear()).toBeGreaterThan(2000);
  });

  it('is append-only, and read by app_api alone', async () => {
    const id = await asMigratorIn(tenant.id, (client) =>
      insertRow(client, TABLE, monitoringRow(tenant, parts)),
    );
    await asRoleIn('app_api', tenant.id, async (client) => {
      expect(await outcome(client, `SELECT id FROM ${TABLE} WHERE id = $1`, [id])).toBe('ok');
      expect(
        await outcome(client, `UPDATE ${TABLE} SET outcome = 'refused' WHERE id = $1`, [id]),
      ).toBe('42501');
      expect(await outcome(client, `DELETE FROM ${TABLE} WHERE id = $1`, [id])).toBe('42501');
    });
    await asRoleIn('app_worker', tenant.id, async (client) => {
      expect(await outcome(client, `SELECT id FROM ${TABLE} WHERE id = $1`, [id])).toBe('42501');
    });
    const author = await asMigratorIn(tenant.id, (client) => addMember(client, tenant));
    expect(await insert(warehouseRow(tenant, parts, { updated_by: author }))).toBe('23514');
  });
});
