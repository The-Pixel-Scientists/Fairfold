// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Equality monitoring reports (ADR 0032). A report counts one question's
// answers, broken down by at most one dimension, under at most one filter,
// each from a fixed list. Its response carries only suppressed aggregates:
// each cell is a count of zero or at least the applied threshold, or a
// marker with nothing else in it, and totals take the marker too. A table
// whose population is below the minimum group is withheld whole. No field
// holds a person, party or application id, or any free text.
//
// The response schema holds each table to the rules one table can show
// (ADR 0032): the threshold (rule 1), whole-group outcomes (rule 2),
// secondary suppression over every row, column and the total column, with
// suppressed cells beside a shown total holding at least the threshold
// between them (rule 3), and the minimum group (rule 4). The server (S12-45) counts the
// rounds closed for monitoring (rule 5), and alone can apply the rules
// across tables: linked tables (rule 6) and the run log (rule 7).

import { idSchema } from '@pixel-scientists/domain';
import { z } from 'zod';

import { appliedDisclosureRuleSchema, disclosureFloor } from './disclosure.ts';

/** What a table's columns may be: each outcome, or each stage reached. Answers are never crossed. */
export const monitoringBreakdowns = ['outcome', 'stage_reached'] as const;

export type MonitoringBreakdown = (typeof monitoringBreakdowns)[number];

/** A question, answer option or outcome code: S11-54's question set holds the questions. */
export const monitoringCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

/** One equality from a fixed list. Regions follow once their code list exists. */
export const monitoringFilterSchema = z.discriminatedUnion('field', [
  z.strictObject({ field: z.literal('programme'), operator: z.literal('eq'), value: idSchema }),
  z.strictObject({ field: z.literal('round'), operator: z.literal('eq'), value: idSchema }),
  z.strictObject({
    field: z.literal('financial_year'),
    operator: z.literal('eq'),
    value: z.int().min(2000).max(2100),
  }),
]);

export type MonitoringFilter = z.infer<typeof monitoringFilterSchema>;

/** A count shown: zero, or at least the platform floor and the applied threshold. */
const shownCellSchema = z.strictObject({
  suppressed: z.literal(false),
  count: z.union([z.literal(0), z.int().min(disclosureFloor.threshold)]),
});

/** Suppressed: no count, percentage or bounds. */
const suppressedCellSchema = z.strictObject({ suppressed: z.literal(true) });

export const monitoringCellSchema = z.discriminatedUnion('suppressed', [
  shownCellSchema,
  suppressedCellSchema,
]);

export type MonitoringCell = z.infer<typeof monitoringCellSchema>;

const MAX_COLUMNS = 30;
const MAX_ROWS = 30;

const lineSchema = z.strictObject({
  cells: z.array(monitoringCellSchema).max(MAX_COLUMNS),
  total: monitoringCellSchema,
});

/** Columns are outcome codes or stage ids; rows are answer options, "Prefer not to say" among them. */
const tableSchema = z.strictObject({
  columns: z.array(z.union([monitoringCodeSchema, idSchema])).max(MAX_COLUMNS),
  rows: z
    .array(z.strictObject({ option: monitoringCodeSchema, ...lineSchema.shape }))
    .min(1)
    .max(MAX_ROWS),
  totals: lineSchema,
});

export const monitoringReportSchema = z
  .strictObject({
    runId: idSchema,
    reportId: idSchema,
    reportVersion: z.int().min(1),
    question: monitoringCodeSchema,
    breakdown: z.enum(monitoringBreakdowns).nullable(),
    filter: monitoringFilterSchema.nullable(),
    disclosureRule: appliedDisclosureRuleSchema,
    result: z.discriminatedUnion('status', [
      z.strictObject({ status: z.literal('shown'), table: tableSchema }),
      z.strictObject({ status: z.literal('withheld') }),
    ]),
  })
  .superRefine(({ breakdown, disclosureRule, result }, context) => {
    if (result.status === 'withheld') return;
    const fail = (message: string) => {
      context.addIssue({ code: 'custom', message });
    };
    const shownCount = (cell: MonitoringCell | undefined) =>
      cell === undefined || cell.suppressed ? null : cell.count;
    const { columns, rows, totals } = result.table;
    const lines = [...rows, totals];
    if ((breakdown === null) !== (columns.length === 0)) {
      fail('A table has columns only when it has a breakdown.');
    }
    for (const line of lines) {
      if (line.cells.length !== columns.length) {
        fail('Each line has a cell for each column.');
      }
      for (const cell of [...line.cells, line.total]) {
        const count = shownCount(cell);
        if (count !== null && count > 0 && count < disclosureRule.threshold) {
          fail('A count below the threshold is shown.');
        }
      }
    }
    // Rule 3: no suppressed cell can be found by subtraction. A hidden total
    // counts as one of its line's suppressed cells. Where the total is shown,
    // the line adds up and its suppressed cells hold at least the threshold
    // between them: suppressed cells are never zero, so less would pin them.
    const rowLines = columns.length > 0 ? lines : [];
    const columnLines = columns.map((_, index) => ({
      cells: rows.map((row) => row.cells[index]),
      total: totals.cells[index],
    }));
    const totalColumn = { cells: rows.map((row) => row.total), total: totals.total };
    for (const { cells, total } of [...rowLines, ...columnLines, totalColumn]) {
      const suppressed = cells.filter((cell) => cell?.suppressed === true).length;
      const lineTotal = shownCount(total);
      if (lineTotal === null ? suppressed === 0 : suppressed === 1) {
        fail('A row or column has exactly one suppressed cell.');
        continue;
      }
      if (lineTotal === null) continue;
      const residual = cells.reduce((rest, cell) => rest - (shownCount(cell) ?? 0), lineTotal);
      if (suppressed === 0 && residual !== 0) {
        fail('A row or column does not add up to its total.');
      } else if (suppressed > 0 && residual < disclosureRule.threshold) {
        fail('Suppressed cells in a row or column hold fewer people than the threshold.');
      }
    }
    // Rule 4: the population of a table shown is at least the minimum group.
    const population = shownCount(totals.total);
    if (population !== null && population < disclosureRule.minimumGroup) {
      fail('A table below the minimum group is shown.');
    }
    // Rule 2: an outcome held by all or none of a group gives away each member's outcome.
    if (breakdown !== 'outcome') return;
    for (const { cells, total } of rows) {
      const group = shownCount(total);
      if (group === 0) continue;
      const counts = cells.map(shownCount).filter((count) => count !== null);
      if (counts.some((count) => count === 0 || count === group)) {
        fail('An outcome held by all or none of a group is shown.');
      }
    }
  });

export type MonitoringReport = z.infer<typeof monitoringReportSchema>;
