// SPDX-License-Identifier: AGPL-3.0-or-later

import { configDiffSchemas } from '@pixel-scientists/domain/platform/settings';
import { describe, expect, it } from 'vitest';

import {
  reportDefinitionDiff,
  reportDefinitionInputSchema,
  type ReportDefinitionInput,
} from './definitions.ts';
import { publicationRunInputSchema } from './publications.ts';

const a = '0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const b = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const warehouse: ReportDefinitionInput = {
  kind: 'warehouse',
  name: 'Awards by programme',
  description: null,
  source: 'commitment',
  measures: { [a]: 'count', [b]: 'sum.amount_minor' },
  groupBy: { [a]: 'programme_id' },
  filters: { [a]: { field: 'currency', operator: 'eq', value: 'GBP' } },
};

const monitoring: ReportDefinitionInput = {
  kind: 'monitoring',
  name: 'Ethnic group by outcome',
  description: 'Spring round',
  source: 'ethnic_group',
  groupBy: { [a]: 'outcome' },
  filters: { [a]: { field: 'round', operator: 'eq', value: b } },
};

const parse = (input: object) => reportDefinitionInputSchema.safeParse(input).success;

describe('a report definition', () => {
  it('takes a warehouse report over one table’s columns', () => {
    expect(parse(warehouse)).toBe(true);
    expect(parse({ ...warehouse, groupBy: { [a]: 'title' } })).toBe(false);
    expect(parse({ ...warehouse, measures: { [a]: 'sum.score' } })).toBe(false);
    expect(parse({ ...warehouse, measures: {} })).toBe(false);
    expect(parse({ ...warehouse, measures: { [a]: 'median.amount_minor' } })).toBe(false);
    expect(parse({ ...warehouse, source: 'monitoring_response' })).toBe(false);
  });

  it('takes a monitoring report with one breakdown and one filter at most, from fixed lists', () => {
    expect(parse(monitoring)).toBe(true);
    expect(parse({ ...monitoring, groupBy: {}, filters: {} })).toBe(true);
    expect(parse({ ...monitoring, groupBy: { [a]: 'outcome', [b]: 'stage_reached' } })).toBe(false);
    expect(parse({ ...monitoring, groupBy: { [a]: 'disability' } })).toBe(false);
    const two = {
      [a]: monitoring.filters[a],
      [b]: { field: 'financial_year', operator: 'eq', value: 2026 },
    };
    expect(parse({ ...monitoring, filters: two })).toBe(false);
    expect(
      parse({ ...monitoring, filters: { [a]: { field: 'region', operator: 'eq', value: 'x' } } }),
    ).toBe(false);
    expect(parse({ ...monitoring, measures: { [a]: 'count' } })).toBe(false);
  });

  it('refuses a blank name, hidden characters, upper case ids and unknown keys', () => {
    expect(parse({ ...warehouse, name: '  ' })).toBe(false);
    expect(parse({ ...warehouse, name: 'Awards​' })).toBe(false);
    expect(parse({ ...warehouse, groupBy: { [a.toUpperCase()]: 'programme_id' } })).toBe(false);
    expect(parse({ ...warehouse, tenantId: a })).toBe(false);
    expect(parse({ ...monitoring, kind: 'export' })).toBe(false);
  });
});

const diffSchema = configDiffSchemas['insight.report_definition'];

describe('reportDefinitionDiff', () => {
  it('writes diffs the config diff schema takes', () => {
    expect(diffSchema.safeParse(reportDefinitionDiff(null, warehouse)).success).toBe(true);
    expect(diffSchema.safeParse(reportDefinitionDiff(null, monitoring)).success).toBe(true);
  });

  it('lists every recorded value of a new report', () => {
    expect(reportDefinitionDiff(null, warehouse)).toEqual([
      { path: 'name', from: null, to: 'Awards by programme' },
      { path: 'source', from: null, to: 'commitment' },
      { path: `measures.${a}`, from: null, to: 'count' },
      { path: `measures.${b}`, from: null, to: 'sum.amount_minor' },
      { path: `groupBy.${a}`, from: null, to: 'programme_id' },
      { path: `filters.${a}.field`, from: null, to: 'currency' },
      { path: `filters.${a}.operator`, from: null, to: 'eq' },
    ]);
  });

  it('never records a filter’s value', () => {
    const changed = {
      ...warehouse,
      filters: { [a]: { field: 'currency', operator: 'eq' as const, value: 'EUR' } },
    };
    expect(reportDefinitionDiff(warehouse, changed)).toEqual([]);
    const diff = reportDefinitionDiff(null, monitoring);
    expect(JSON.stringify(diff)).not.toContain(b);
    expect(
      diffSchema.safeParse([{ path: `filters.${a}.value`, from: null, to: 'GBP' }]).success,
    ).toBe(false);
  });

  it('lists a removed item going to null', () => {
    const fewer = { ...warehouse, measures: { [a]: 'count' }, name: 'Awards' };
    expect(reportDefinitionDiff(warehouse, fewer)).toEqual([
      { path: 'name', from: 'Awards by programme', to: 'Awards' },
      { path: `measures.${b}`, from: 'sum.amount_minor', to: null },
    ]);
  });
});

describe('a publication run', () => {
  it('covers a period that ends after it starts', () => {
    const input = { kind: 'annual_return', periodStart: '2026-04-01', periodEnd: '2027-03-31' };
    expect(publicationRunInputSchema.safeParse(input).success).toBe(true);
    const backwards = { ...input, periodEnd: '2026-04-01' };
    expect(publicationRunInputSchema.safeParse(backwards).success).toBe(false);
    expect(publicationRunInputSchema.safeParse({ ...input, kind: 'gift_aid' }).success).toBe(false);
    expect(publicationRunInputSchema.safeParse({ ...input, submit: true }).success).toBe(false);
  });
});
