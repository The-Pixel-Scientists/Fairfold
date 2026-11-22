// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A report's form as plain values, and the contract's input built from them.
// Each measure, group and filter keeps its item id, so a save changes only
// what the person changed.

import { warehouseTables } from '@pixel-scientists/domain/warehouse';
import type { WarehouseTableName } from '@pixel-scientists/domain/warehouse';

import type {
  MonitoringBreakdown,
  MonitoringFilter,
  ReportDefinition,
  ReportDefinitionInput,
  ReportKind,
} from '../../contracts/index.ts';

export interface Draft {
  kind: ReportKind;
  name: string;
  description: string;
  /** A warehouse table, or an equality monitoring question's code. */
  source: string;
  /** Warehouse: `count` and `sum.<column>` choices. */
  measures: string[];
  /** Warehouse: columns. Monitoring: the breakdown, if any. */
  groupBy: string[];
  /** Monitoring: a financial year, which is the one filter the form offers. */
  year: string;
}

type Items = Readonly<Record<string, string>>;

export const emptyDraft = (kind: ReportKind): Draft => ({
  kind,
  name: '',
  description: '',
  source: kind === 'warehouse' ? 'programme' : '',
  measures: ['count'],
  groupBy: [],
  year: '',
});

const values = (items: Items): string[] => Object.values(items);

export function draftOf(report: ReportDefinition): Draft {
  const year = Object.values(report.filters).find(
    (filter) => 'field' in filter && filter.field === 'financial_year',
  );
  return {
    kind: report.kind,
    name: report.name,
    description: report.description ?? '',
    source: report.source,
    measures: report.kind === 'warehouse' ? values(report.measures) : [],
    groupBy: values(report.groupBy),
    year: year !== undefined && typeof year.value === 'number' ? String(year.value) : '',
  };
}

/** The columns a warehouse report may count, add up or group by. */
export function columnsOf(source: string): [string, { type: string }][] {
  const table = (warehouseTables as Record<string, { columns: Record<string, { type: string }> }>)[
    source
  ];
  return Object.entries(table?.columns ?? {}).filter(([name]) => name !== 'source_module');
}

export const isWarehouseTable = (source: string): source is WarehouseTableName =>
  Object.hasOwn(warehouseTables, source);

/** Keeps the id of each value already in the report, and gives a new one to the rest. */
function keyed(before: Items, chosen: readonly string[]): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(before).map(([id, value]) => [value, id]));
  return Object.fromEntries(chosen.map((value) => [kept[value] ?? crypto.randomUUID(), value]));
}

/**
 * The body to send. A filter the form does not offer (a programme or a round)
 * is kept as it was, and the year filter is the form's own. What the server
 * will not accept is refused by the contract's checks in call().
 */
export function inputOf(draft: Draft, before: ReportDefinition | null): ReportDefinitionInput {
  const common = {
    name: draft.name,
    description: draft.description.trim() === '' ? null : draft.description,
    source: draft.source,
  };
  if (draft.kind === 'warehouse') {
    const filters = before?.kind === 'warehouse' ? before.filters : {};
    return {
      kind: 'warehouse',
      ...common,
      source: draft.source as WarehouseTableName,
      measures: keyed(before?.kind === 'warehouse' ? before.measures : {}, draft.measures),
      groupBy: keyed(before?.groupBy ?? {}, draft.groupBy),
      filters,
    };
  }
  const entries = Object.entries(before?.kind === 'monitoring' ? before.filters : {});
  const others = entries.filter(([, filter]) => filter.field !== 'financial_year');
  const yearId = entries.find(([, filter]) => filter.field === 'financial_year')?.[0];
  const year: [string, MonitoringFilter][] =
    draft.year.trim() === ''
      ? []
      : [
          [
            yearId ?? crypto.randomUUID(),
            { field: 'financial_year', operator: 'eq', value: Number(draft.year) },
          ],
        ];
  return {
    kind: 'monitoring',
    ...common,
    groupBy: keyed(before?.groupBy ?? {}, draft.groupBy) as Record<string, MonitoringBreakdown>,
    filters: Object.fromEntries([...others, ...year]),
  };
}
