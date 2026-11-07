// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { disclosureFloor, disclosureRuleInputSchema } from './disclosure.ts';
import {
  monitoringCellSchema,
  monitoringReportSchema,
  type MonitoringReport,
} from './monitoring.ts';

const id = '3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f';
const shown = (count: number) => ({ suppressed: false as const, count });
const hidden = { suppressed: true as const };

function report(overrides: Partial<MonitoringReport> = {}): MonitoringReport {
  return {
    runId: id,
    reportId: id,
    reportVersion: 1,
    question: 'ethnic_group',
    breakdown: 'outcome',
    filter: { field: 'round', operator: 'eq', value: id },
    disclosureRule: { version: null, threshold: 10, minimumGroup: 20 },
    result: {
      status: 'shown',
      table: {
        columns: ['awarded', 'declined'],
        rows: [
          { option: 'asian', cells: [shown(12), hidden], total: hidden },
          { option: 'white', cells: [shown(20), hidden], total: hidden },
          { option: 'prefer_not_to_say', cells: [shown(0), shown(0)], total: shown(0) },
        ],
        totals: { cells: [shown(32), shown(25)], total: shown(57) },
      },
    },
    ...overrides,
  };
}

type Table = Extract<MonitoringReport['result'], { status: 'shown' }>['table'];

const shownRow = (option: string, count: number) => ({ option, cells: [], total: shown(count) });

function withTable(table: Table, overrides: Partial<MonitoringReport> = {}) {
  return report({ result: { status: 'shown', table }, ...overrides });
}

/** The messages a report is refused with, none when it is taken. */
function issues(input: unknown): string[] {
  return monitoringReportSchema.safeParse(input).error?.issues.map(({ message }) => message) ?? [];
}

describe('the disclosure floor', () => {
  it('is a threshold of 10 and a minimum group of 20 (ADR 0032)', () => {
    expect(disclosureFloor).toEqual({ threshold: 10, minimumGroup: 20 });
  });

  it('refuses a rule below it, and a minimum group below the threshold', () => {
    const parse = (input: object) => disclosureRuleInputSchema.safeParse(input).success;
    expect(parse({ threshold: 10, minimumGroup: 20 })).toBe(true);
    expect(parse({ threshold: 15, minimumGroup: 30 })).toBe(true);
    expect(parse({ threshold: 9, minimumGroup: 20 })).toBe(false);
    expect(parse({ threshold: 10, minimumGroup: 19 })).toBe(false);
    expect(parse({ threshold: 30, minimumGroup: 25 })).toBe(false);
    expect(parse({ threshold: 10.5, minimumGroup: 20 })).toBe(false);
    expect(parse({ threshold: 10, minimumGroup: 20, secondarySuppression: false })).toBe(false);
  });
});

describe('a monitoring cell', () => {
  it('shows zero, or a count at or above the floor', () => {
    for (const count of [0, 10, 11, 500]) {
      expect(monitoringCellSchema.safeParse(shown(count)).success, `${count}`).toBe(true);
    }
    for (const count of [1, 5, 9, -1, 10.5]) {
      expect(monitoringCellSchema.safeParse(shown(count)).success, `${count}`).toBe(false);
    }
  });

  it('suppressed, carries no count, percentage or bounds', () => {
    expect(monitoringCellSchema.safeParse(hidden).success).toBe(true);
    for (const extra of [{ count: 3 }, { count: 0 }, { percent: 5 }, { min: 1, max: 9 }]) {
      expect(monitoringCellSchema.safeParse({ ...hidden, ...extra }).success).toBe(false);
    }
    expect(monitoringCellSchema.safeParse({ suppressed: false }).success).toBe(false);
  });
});

describe('the monitoring report response', () => {
  it('takes a table of suppressed aggregates, or a withheld table', () => {
    expect(monitoringReportSchema.safeParse(report()).success).toBe(true);
    const withheld = report({ result: { status: 'withheld' } });
    expect(monitoringReportSchema.safeParse(withheld).success).toBe(true);
    const withTable = { ...withheld, result: { status: 'withheld', table: report().result } };
    expect(monitoringReportSchema.safeParse(withTable).success).toBe(false);
  });

  it('refuses a shown count below the threshold the tenant applied', () => {
    const raised = report({ disclosureRule: { version: 2, threshold: 15, minimumGroup: 30 } });
    expect(monitoringReportSchema.safeParse(raised).success).toBe(false);
    const lowered = report({ disclosureRule: { version: 2, threshold: 5, minimumGroup: 20 } });
    expect(monitoringReportSchema.safeParse(lowered).success).toBe(false);
  });

  it('refuses a margin or total with a small count', () => {
    const base = report();
    if (base.result.status !== 'shown') throw new Error('shown');
    const table = {
      ...base.result.table,
      totals: { cells: [shown(32), shown(25)], total: shown(7) },
    };
    const small = { ...base, result: { status: 'shown' as const, table } };
    expect(monitoringReportSchema.safeParse(small).success).toBe(false);
  });

  it('refuses ids of people, parties or applications, and free text', () => {
    for (const extra of [
      { personId: id },
      { partyId: id },
      { applicationIds: [id] },
      { note: 'Fewer than 10' },
    ]) {
      expect(monitoringReportSchema.safeParse({ ...report(), ...extra }).success).toBe(false);
    }
    const base = report();
    if (base.result.status !== 'shown') throw new Error('shown');
    const [row] = base.result.table.rows;
    const table = { ...base.result.table, rows: [{ ...row, label: 'Asian or Asian British' }] };
    expect(
      monitoringReportSchema.safeParse({ ...base, result: { status: 'shown', table } }).success,
    ).toBe(false);
  });

  it('names the disclosure rule version applied', () => {
    const versioned = report({ disclosureRule: { version: 3, threshold: 10, minimumGroup: 20 } });
    expect(monitoringReportSchema.parse(versioned).disclosureRule.version).toBe(3);
    const without: Partial<MonitoringReport> = report();
    delete without.disclosureRule;
    expect(monitoringReportSchema.safeParse(without).success).toBe(false);
  });

  it('refuses a row with one suppressed cell beside a shown total (rule 3)', () => {
    // Probe A: 15 less 12 shows the hidden Asian declined count is 3.
    const table: Table = {
      columns: ['awarded', 'declined'],
      rows: [
        { option: 'asian', cells: [shown(12), hidden], total: shown(15) },
        { option: 'white', cells: [shown(20), shown(25)], total: shown(45) },
        { option: 'mixed', cells: [hidden, hidden], total: hidden },
        { option: 'other', cells: [hidden, hidden], total: hidden },
      ],
      totals: { cells: [shown(42), shown(36)], total: shown(78) },
    };
    expect(issues(withTable(table))).toEqual(['A row or column has exactly one suppressed cell.']);
  });

  it('refuses a column with one suppressed cell beside a shown total (rule 3)', () => {
    // Probe U: 58 less 40 and 13 shows the hidden Asian declined count is 5.
    const table: Table = {
      columns: ['awarded', 'declined'],
      rows: [
        { option: 'asian', cells: [shown(12), hidden], total: hidden },
        { option: 'white', cells: [shown(20), shown(40)], total: shown(60) },
        { option: 'other', cells: [hidden, shown(13)], total: hidden },
      ],
      totals: { cells: [hidden, shown(58)], total: hidden },
    };
    expect(issues(withTable(table))).toEqual(['A row or column has exactly one suppressed cell.']);
  });

  it('refuses a total column with one suppressed cell beside a shown total (rule 3)', () => {
    // Probe U, without a breakdown: 55 less 40 shows the hidden group is 15.
    const table = (...hiddenOptions: string[]): Table => ({
      columns: [],
      rows: [
        { option: 'white', cells: [], total: shown(40) },
        ...hiddenOptions.map((option) => ({ option, cells: [], total: hidden })),
      ],
      totals: { cells: [], total: shown(55) },
    });
    expect(issues(withTable(table('asian'), { breakdown: null }))).toEqual([
      'A row or column has exactly one suppressed cell.',
    ]);
    expect(issues(withTable(table('asian', 'mixed'), { breakdown: null }))).toEqual([]);
  });

  it('refuses suppressed cells holding fewer than the threshold beside a shown total (rule 3)', () => {
    const refused = ['Suppressed cells in a row or column hold fewer people than the threshold.'];
    // Probe P1: 32 less 30 leaves 2 for two non-zero cells, so each Asian
    // applicant's outcome is pinned, though the columns hide 10 and 13.
    const row = (asianTotal: number): Table => ({
      columns: ['awarded', 'declined', 'withdrawn'],
      rows: [
        { option: 'asian', cells: [shown(30), hidden, hidden], total: shown(asianTotal) },
        { option: 'white', cells: [shown(40), hidden, hidden], total: shown(93 - asianTotal) },
      ],
      totals: { cells: [shown(70), shown(10), shown(13)], total: shown(93) },
    });
    expect(issues(withTable(row(32)))).toEqual(refused);
    expect(issues(withTable(row(40)))).toEqual([]);
    // Probe P4, without a breakdown: 22 less 20 leaves one Asian and one Mixed applicant.
    const column = (population: number): Table => ({
      columns: [],
      rows: [
        shownRow('white', 20),
        { option: 'asian', cells: [], total: hidden },
        { option: 'mixed', cells: [], total: hidden },
      ],
      totals: { cells: [], total: shown(population) },
    });
    expect(issues(withTable(column(22), { breakdown: null }))).toEqual(refused);
    expect(issues(withTable(column(29), { breakdown: null }))).toEqual(refused);
    expect(issues(withTable(column(30), { breakdown: null }))).toEqual([]);
    // Nothing left over shows the suppressed cells are zeros.
    expect(issues(withTable(column(20), { breakdown: null }))).toEqual(refused);
    const raised = { version: 2, threshold: 15, minimumGroup: 30 };
    expect(issues(withTable(column(32), { breakdown: null, disclosureRule: raised }))).toEqual(
      refused,
    );
  });

  it('refuses a row or column that does not add up to its total', () => {
    // An answer left out of the table would be found by subtraction.
    const table: Table = {
      columns: [],
      rows: [shownRow('white', 20), shownRow('asian', 15)],
      totals: { cells: [], total: shown(40) },
    };
    expect(issues(withTable(table, { breakdown: null }))).toEqual([
      'A row or column does not add up to its total.',
    ]);
  });

  it('refuses a table shown below the minimum group (rule 4)', () => {
    // Probe B: a population of 12 is shown where the minimum group is 20.
    const table = (population: number): Table => ({
      columns: [],
      rows: [
        { option: 'asian', cells: [], total: shown(population) },
        { option: 'white', cells: [], total: shown(0) },
      ],
      totals: { cells: [], total: shown(population) },
    });
    const refused = ['A table below the minimum group is shown.'];
    expect(issues(withTable(table(12), { breakdown: null }))).toEqual(refused);
    expect(issues(withTable(table(0), { breakdown: null }))).toEqual(refused);
    expect(issues(withTable(table(20), { breakdown: null }))).toEqual([]);
    const raised = { version: 2, threshold: 10, minimumGroup: 30 };
    expect(issues(withTable(table(25), { breakdown: null, disclosureRule: raised }))).toEqual(
      refused,
    );
  });

  it('refuses an outcome held by all or none of a group (rule 2)', () => {
    // Probe T: every Asian applicant was declined.
    const white = { option: 'white', cells: [shown(20), shown(25)], total: shown(45) };
    const table = (awarded: number, declined: number): Table => ({
      columns: ['awarded', 'declined'],
      rows: [
        {
          option: 'asian',
          cells: [shown(awarded), shown(declined)],
          total: shown(awarded + declined),
        },
        white,
      ],
      totals: {
        cells: [shown(awarded + 20), shown(declined + 25)],
        total: shown(awarded + declined + 45),
      },
    });
    const refused = ['An outcome held by all or none of a group is shown.'];
    expect(issues(withTable(table(0, 15)))).toEqual(refused);
    expect(issues(withTable(table(15, 0)))).toEqual(refused);
    const behind: Table = {
      columns: ['awarded', 'declined'],
      rows: [{ option: 'asian', cells: [shown(0), hidden], total: hidden }, white],
      totals: { cells: [shown(20), hidden], total: hidden },
    };
    expect(issues(withTable(behind))).toEqual(refused);
    // Rule 2 is for outcomes; an empty group gives nothing away.
    expect(issues(withTable(table(0, 15), { breakdown: 'stage_reached' }))).toEqual([]);
    expect(issues(withTable(table(0, 0)))).toEqual([]);
  });

  it('keeps each line to its columns, and no columns without a breakdown', () => {
    const base = report();
    if (base.result.status !== 'shown') throw new Error('shown');
    const ragged = {
      ...base.result.table,
      rows: [{ option: 'asian', cells: [shown(12)], total: hidden }],
    };
    expect(
      monitoringReportSchema.safeParse({ ...base, result: { status: 'shown', table: ragged } })
        .success,
    ).toBe(false);
    expect(monitoringReportSchema.safeParse({ ...base, breakdown: null }).success).toBe(false);
    const noColumns: Table = {
      columns: [],
      rows: [{ option: 'asian', cells: [], total: shown(30) }],
      totals: { cells: [], total: shown(30) },
    };
    expect(issues(withTable(noColumns))).toEqual([
      'A table has columns only when it has a breakdown.',
    ]);
    expect(issues(withTable(noColumns, { breakdown: null }))).toEqual([]);
  });

  it('takes only the fixed breakdowns and filters', () => {
    for (const breakdown of ['region', 'disability', 'organisation']) {
      expect(monitoringReportSchema.safeParse({ ...report(), breakdown }).success).toBe(false);
    }
    for (const filter of [
      { field: 'organisation', operator: 'eq', value: id },
      { field: 'round', operator: 'ne', value: id },
      { field: 'round', operator: 'eq', value: 'Spring round' },
      { field: 'financial_year', operator: 'eq', value: 2026, to: 2027 },
    ]) {
      expect(monitoringReportSchema.safeParse({ ...report(), filter }).success).toBe(false);
    }
  });
});
