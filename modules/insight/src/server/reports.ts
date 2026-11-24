// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Running a warehouse report, and reading either kind of run back. The
// platform has already checked the session, the permission and that insight
// is on. The report's figures are worked out in the request from the
// warehouse's rows, which hold public and internal columns only (ADR 0016),
// and are answered once: the run keeps who ran which version of the report,
// when and with what outcome, and no figure (ADR 0032). Reading a run back
// never returns a figure, and a monitoring run's table never leaves the run
// log.

import {
  insightRefusals,
  MAX_REPORT_ROWS,
  type ReportKind,
  type ReportResult,
  type ReportRun,
} from '../contracts/index.ts';
import {
  insightDb,
  iso,
  type Args,
  type InsightDependencies,
  type ReportParams,
  type Tx,
  type WarehouseRow,
} from './context.ts';
import { inputOf, readDefinitionRow } from './definitions.ts';
import { serverRefusals } from './messages.ts';
import { insertRun } from './run-log.ts';

type Value = string | number | boolean | null;

/** How `a` sorts against `b`, or null where either is missing. Numbers sort as numbers, the rest as text. */
function rank(a: Value, b: Value): number | null {
  if (a === null || b === null) return null;
  if (typeof a === 'number' && typeof b !== 'boolean' && Number.isFinite(Number(b))) {
    return Math.sign(a - Number(b));
  }
  const [x, y] = [String(a), String(b)];
  return x === y ? 0 : x < y ? -1 : 1;
}

type Filter = { field: string; operator: string; value: Value };

function passes(value: Value, { operator, value: expected }: Filter): boolean {
  const order = rank(value, expected);
  switch (operator) {
    case 'eq':
      return value === null || expected === null ? value === expected : order === 0;
    case 'ne':
      return value === null || expected === null ? value !== expected : order !== 0;
    case 'lt':
      return order !== null && order < 0;
    case 'lte':
      return order !== null && order <= 0;
    case 'gt':
      return order !== null && order > 0;
    case 'gte':
      return order !== null && order >= 0;
    case 'is_null':
      return value === null;
    default:
      return value !== null;
  }
}

const cell = (row: WarehouseRow, column: string): Value => row[column] ?? null;

/** A measure over a group's rows: `count`, or a function over one column's values that are present. */
function measureOf(spec: string, rows: readonly WarehouseRow[]): Value {
  if (spec === 'count') return rows.length;
  const [fn, column = ''] = spec.split('.');
  const values = rows.map((row) => cell(row, column)).filter((value) => value !== null);
  if (fn === 'min' || fn === 'max') {
    const sign = fn === 'min' ? -1 : 1;
    return values.reduce<Value>(
      (best, value) => (best === null || sign * (rank(value, best) ?? 0) > 0 ? value : best),
      null,
    );
  }
  const numbers = values.filter((value) => typeof value === 'number');
  if (numbers.length === 0) return null;
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return fn === 'sum' ? total : Math.round((total / numbers.length) * 100) / 100;
}

/** Groups sort by their values, absent ones first. */
function byGroup(a: readonly Value[], b: readonly Value[]): number {
  for (const [index, left] of a.entries()) {
    const right = b[index] ?? null;
    const order =
      left === null || right === null
        ? Number(left !== null) - Number(right !== null)
        : rank(left, right);
    if (order !== null && order !== 0) return order;
  }
  return 0;
}

export function reportHandlers(deps: InsightDependencies) {
  async function readRun(tx: Tx, runId: string, kind: ReportKind): Promise<ReportRun> {
    const row = await insightDb(tx)
      .selectFrom('insight.report_run')
      .select([
        'id',
        'report_id',
        'report_version',
        'kind',
        'outcome',
        'disclosure_rule_version',
        'created_at',
        'created_by',
      ])
      .where('id', '=', runId)
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (row === undefined) throw deps.notFound();
    return {
      id: row.id,
      reportId: row.report_id,
      reportVersion: row.report_version,
      kind,
      outcome: row.outcome as ReportRun['outcome'],
      disclosureRuleVersion: row.disclosure_rule_version,
      ranAt: iso(row.created_at),
      ranByMembershipId: row.created_by,
    };
  }

  async function runReport({ tx, context, input }: Args<ReportParams>): Promise<ReportResult> {
    const { reportId } = input.params;
    const found = await readDefinitionRow(tx, reportId);
    if (found === undefined) throw deps.notFound();
    const definition = inputOf(found);
    if (definition.kind !== 'warehouse') throw deps.refuse(409, insightRefusals.monitoringOnly);
    if (found.archived_at !== null) throw deps.refuse(409, insightRefusals.archived);

    const source = await deps.warehouseRows(tx, definition.source);
    if (source.status === 'off') throw deps.refuse(409, serverRefusals.sourceOff);
    if (source.status === 'unavailable') throw deps.refuse(409, serverRefusals.sourceUnavailable);
    const { measures, groupBy, filters } = definition;
    const used = [
      ...Object.values(measures).flatMap((measure) => measure.split('.').slice(1)),
      ...Object.values(groupBy),
      ...Object.values(filters).map(({ field }) => field),
    ];
    if (used.some((column) => !source.columns.includes(column))) {
      throw deps.refuse(409, serverRefusals.columnUnavailable);
    }

    const kept = source.rows.filter((row) =>
      Object.values(filters).every((filter) => passes(cell(row, filter.field), filter)),
    );
    const groupColumns = Object.values(groupBy);
    const groups = new Map<string, { values: Value[]; rows: WarehouseRow[] }>();
    for (const row of kept) {
      const values = groupColumns.map((column) => cell(row, column));
      const key = JSON.stringify(values);
      const group = groups.get(key) ?? { values, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    // With no grouping the whole table is one group, which is there even when it holds no rows.
    if (groupColumns.length === 0 && groups.size === 0) groups.set('[]', { values: [], rows: [] });
    const ordered = [...groups.values()].sort((a, b) => byGroup(a.values, b.values));

    const runId = await insertRun(tx, {
      reportId,
      reportVersion: found.version,
      kind: 'warehouse',
      outcome: 'shown',
      ruleVersion: null,
      by: context.membership.id,
    });
    await context.audit.record({
      action: 'insight.report.run',
      entityId: reportId,
      changes: { 'insight.report_definition.version': { after: found.version } },
    });
    return {
      run: await readRun(tx, runId, 'warehouse'),
      columns: [
        ...Object.keys(groupBy).map((itemId) => ({ itemId, role: 'group' as const })),
        ...Object.keys(measures).map((itemId) => ({ itemId, role: 'measure' as const })),
      ],
      rows: ordered
        .slice(0, MAX_REPORT_ROWS)
        .map(({ values, rows }) => [
          ...values,
          ...Object.values(measures).map((measure) => measureOf(measure, rows)),
        ]),
      truncated: ordered.length > MAX_REPORT_ROWS,
    };
  }

  return {
    runReport,
    getReportRun: ({ tx, input }: Args<{ params: { runId: string } }>) =>
      readRun(tx, input.params.runId, 'warehouse'),
    getMonitoringReportRun: ({ tx, input }: Args<{ params: { runId: string } }>) =>
      readRun(tx, input.params.runId, 'monitoring'),
  };
}
