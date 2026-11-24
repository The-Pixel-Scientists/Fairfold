// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The run log (ADR 0032, rule 7) over `insight.report_run`. A run keeps the
// suppressed table it showed and nothing else of its figures. Before a table
// is shown it is set against the tables already shown for the same question,
// breakdown and filter: if the difference from any of them, added or taken
// away, is 1 to 19 responses (the minimum group) or 1 to 9 people (the
// threshold) in a cell shown in both, the run is refused. Counts here come
// only from tables already suppressed and from the response count of a shown
// table, which is at least the minimum group.
//
// Programme, year and region tables cannot be run yet, so no run has a parent
// or children to be set against (rule 6). Rule 7's second comparison starts
// to matter when they can.

import type { JsonObject } from '@pixel-scientists/db/generated/insight';

import type { MonitoringBreakdown, MonitoringCell, MonitoringReport } from '../contracts/index.ts';
import { insightDb, type Tx } from './context.ts';

type Shown = Extract<MonitoringReport['result'], { status: 'shown' }>;
export type ShownTable = Shown['table'];

/** The one filter a run can have today: a round. */
export interface RunTable {
  readonly question: string;
  readonly breakdown: MonitoringBreakdown | null;
  readonly roundId: string;
}

export interface NewRun {
  readonly reportId: string;
  readonly reportVersion: number;
  readonly kind: 'warehouse' | 'monitoring';
  readonly outcome: 'shown' | 'withheld' | 'refused';
  readonly ruleVersion: number | null;
  readonly by: string;
  readonly table?: RunTable;
  /** Only for a table shown. */
  readonly shown?: {
    readonly roundIds: readonly string[];
    readonly responses: number;
    readonly table: ShownTable;
  };
}

export async function insertRun(tx: Tx, run: NewRun): Promise<string> {
  const { table, shown } = run;
  const { id } = await insightDb(tx)
    .insertInto('insight.report_run')
    .values((eb) => ({
      tenant_id: eb.fn<string>('app.current_tenant_id', []),
      report_id: run.reportId,
      report_version: run.reportVersion,
      kind: run.kind,
      outcome: run.outcome,
      disclosure_rule_version: run.ruleVersion,
      question: table?.question ?? null,
      breakdown: table?.breakdown ?? null,
      filter_field: table === undefined ? null : 'round',
      filter_id: table?.roundId ?? null,
      round_ids: shown === undefined ? null : [...shown.roundIds],
      population: shown?.responses ?? null,
      shown_table: shown === undefined ? null : (shown.table as unknown as JsonObject),
      created_by: run.by,
      updated_by: run.by,
    }))
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
}

/** Holds off another run of this tenant's question until this request ends, so two cannot slip past each other. */
export async function lockQuestion(tx: Tx, question: string): Promise<void> {
  await insightDb(tx)
    .selectNoFrom((eb) =>
      eb
        .fn('pg_advisory_xact_lock', [
          eb.fn('hashtextextended', [
            eb.fn('concat', [
              eb.cast(eb.fn('app.current_tenant_id', []), 'text'),
              eb.cast(eb.val(`:insight.report_run:${question}`), 'text'),
            ]),
            eb.cast(eb.val(0), 'bigint'),
          ]),
        ])
        .as('locked'),
    )
    .execute();
}

const shownCount = (cell: MonitoringCell | undefined): number | null =>
  cell === undefined || cell.suppressed ? null : cell.count;

/** Each shown cell of a table, by its row's option and its column; a null part is a total. */
function shownCells(table: ShownTable): Map<string, number> {
  const found = new Map<string, number>();
  const add = (option: string | null, column: string | null, cell: MonitoringCell | undefined) => {
    const count = shownCount(cell);
    if (count !== null) found.set(JSON.stringify([option, column]), count);
  };
  for (const { option, cells, total } of table.rows) {
    table.columns.forEach((column, index) => {
      add(option, column, cells[index]);
    });
    add(option, null, total);
  }
  table.columns.forEach((column, index) => {
    add(null, column, table.totals.cells[index]);
  });
  add(null, null, table.totals.total);
  return found;
}

/** The table's earlier shown runs, newest first. */
async function earlierRuns(tx: Tx, { question, breakdown, roundId }: RunTable) {
  const rows = await insightDb(tx)
    .selectFrom('insight.report_run')
    .select(['population', 'shown_table'])
    .where('kind', '=', 'monitoring')
    .where('outcome', '=', 'shown')
    .where('question', '=', question)
    .where((eb) => eb('breakdown', breakdown === null ? 'is' : '=', breakdown))
    .where('filter_field', '=', 'round')
    .where('filter_id', '=', roundId)
    .orderBy('created_at', 'desc')
    .execute();
  return rows.flatMap(({ population, shown_table }) =>
    population === null || shown_table === null
      ? []
      : [{ responses: population, table: shown_table as unknown as ShownTable }],
  );
}

const between = (difference: number, limit: number): boolean =>
  difference > 0 && difference < limit;

/** Whether showing `now` beside the runs already shown would let a small group be found by subtraction. */
export async function revealsSmallGroup(
  tx: Tx,
  table: RunTable,
  now: { readonly responses: number; readonly table: ShownTable },
  rule: { readonly threshold: number; readonly minimumGroup: number },
): Promise<boolean> {
  const cells = shownCells(now.table);
  for (const earlier of await earlierRuns(tx, table)) {
    if (between(Math.abs(now.responses - earlier.responses), rule.minimumGroup)) return true;
    for (const [key, before] of shownCells(earlier.table)) {
      const after = cells.get(key);
      if (after !== undefined && between(Math.abs(after - before), rule.threshold)) return true;
    }
  }
  return false;
}
