// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Disclosure control for one equality monitoring table (ADR 0032, rules 1 to
// 4): the only path from counts to a report's figures. It is a pure function
// over unsuppressed counts, which are special category data: they come in,
// and only the suppressed table leaves. Nothing here logs, stores or returns
// a count that is not safe to show. Linked tables and the run log (rules 6
// and 7) need other runs and a store, and are not applied here.
//
// A table is a grid of cells with a total for each row, each column and the
// whole. Every row and column "line" is held to the same test: its hidden
// cells, with its total, must never leave exactly one thing unknown. Lines
// are also read together: no hidden count may follow from the shown figures
// by combining any number of rows and columns.

import type {
  AppliedDisclosureRule,
  MonitoringBreakdown,
  MonitoringReport,
} from '../contracts/index.ts';

/**
 * A question's counts. With no columns each row's one number is the answers
 * counted for that option; with columns each row has a number for each column.
 */
export interface CountTable {
  readonly breakdown: MonitoringBreakdown | null;
  readonly columns: readonly string[];
  readonly rows: readonly { readonly option: string; readonly cells: readonly number[] }[];
  /** The responses counted. A table over fewer than the minimum group is withheld. */
  readonly respondents: number;
}

export type Disclosed = MonitoringReport['result'];

type Rule = Pick<AppliedDisclosureRule, 'threshold' | 'minimumGroup'>;

interface Line {
  readonly cells: readonly number[];
  readonly total: number;
}

/**
 * The table with small numbers hidden, or withheld whole when the population
 * is below the minimum group or the table cannot be made safe.
 */
export function disclose(table: CountTable, { threshold, minimumGroup }: Rule): Disclosed {
  const { breakdown, columns, rows } = table;
  const width = columns.length + 1;
  const last = rows.length;
  if (rows.some((row) => row.cells.length !== (columns.length === 0 ? 1 : columns.length))) {
    throw new Error('A row has a cell for each column.');
  }

  // The grid: each row's cells and total, then the totals row. The last
  // column holds totals; with no columns it holds the counts themselves.
  const values: number[] = [];
  for (const { cells } of rows) {
    values.push(...(columns.length === 0 ? cells : [...cells, sum(cells)]));
  }
  for (let column = 0; column < width; column += 1) {
    let total = 0;
    for (let row = 0; row < last; row += 1) total += values[row * width + column] ?? 0;
    values.push(total);
  }
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('A count is a whole number of people, never negative.');
  }
  const population = values[last * width + width - 1] ?? 0;
  if (table.respondents < minimumGroup || population < minimumGroup) return { status: 'withheld' };

  // Rule 1: counts below the threshold are hidden; zero is shown.
  const hidden = values.map((value) => value > 0 && value < threshold);
  // Rule 2: on a breakdown by outcome, a cell holding all or none of its group is hidden.
  if (breakdown === 'outcome' && columns.length > 0) {
    for (let row = 0; row < last; row += 1) {
      const group = values[row * width + columns.length] ?? 0;
      for (let column = 0; column < columns.length; column += 1) {
        const value = values[row * width + column];
        if (group > 0 && (value === 0 || value === group)) hidden[row * width + column] = true;
      }
    }
  }

  // Rule 3: while a line fails, or the shown totals fix a hidden count, hide one more.
  const lines = linesOf(columns.length, last);
  for (;;) {
    const failing = lines.find((line) => fails(line, values, hidden, threshold));
    const fixed = failing === undefined ? fixedBy(lines, hidden)[0] : undefined;
    if (failing === undefined && fixed === undefined) break;
    const near =
      failing === undefined
        ? lines.filter((line) => line.total === fixed || line.cells.includes(fixed ?? -1))
        : [failing];
    const next = hideNext(near, values, hidden);
    if (next === undefined) return { status: 'withheld' };
    hidden[next] = true;
  }

  const show = (index: number) =>
    hidden[index] === true
      ? ({ suppressed: true } as const)
      : ({ suppressed: false, count: values[index] ?? 0 } as const);
  const across = (row: number) => ({
    cells: columns.map((_, column) => show(row * width + column)),
    total: show(row * width + columns.length),
  });
  return {
    status: 'shown',
    table: {
      columns: [...columns],
      rows: rows.map(({ option }, row) => ({ option, ...across(row) })),
      totals: across(last),
    },
  };
}

/** The smallest shown non-zero cell of these lines, or else the first shown total. */
function hideNext(
  near: readonly Line[],
  values: readonly number[],
  hidden: readonly boolean[],
): number | undefined {
  const smallest = near
    .flatMap((line) => line.cells)
    .filter((cell) => hidden[cell] !== true && values[cell] !== 0)
    .reduce<number | undefined>(
      (best, cell) =>
        best === undefined || (values[cell] ?? 0) < (values[best] ?? 0) ? cell : best,
      undefined,
    );
  return smallest ?? near.map((line) => line.total).find((total) => hidden[total] !== true);
}

const sum = (numbers: readonly number[]): number => numbers.reduce((total, n) => total + n, 0);

/** Every row and every column of the grid, as indexes into it; the row lines only when there are columns. */
function linesOf(columns: number, rows: number): Line[] {
  const width = columns + 1;
  const range = (length: number) => Array.from({ length }, (_, index) => index);
  const rowLines =
    columns === 0
      ? []
      : range(rows + 1).map((row) => ({
          cells: range(columns).map((column) => row * width + column),
          total: row * width + columns,
        }));
  const columnLines = range(width).map((column) => ({
    cells: range(rows).map((row) => row * width + column),
    total: rows * width + column,
  }));
  return [...rowLines, ...columnLines];
}

/**
 * A line fails when exactly one thing in it is hidden, the total counting as
 * a cell when it is hidden, or when its hidden cells sit beside a shown total
 * and hold fewer people between them than the threshold.
 */
function fails(
  { cells, total }: Line,
  values: readonly number[],
  hidden: readonly boolean[],
  threshold: number,
): boolean {
  const hiddenCells = cells.filter((cell) => hidden[cell] === true);
  if (hidden[total] === true) return hiddenCells.length === 0;
  if (hiddenCells.length === 0) return false;
  return hiddenCells.length === 1 || sum(hiddenCells.map((cell) => values[cell] ?? 0)) < threshold;
}

/**
 * The hidden counts the shown figures fix exactly. Each line gives one
 * equation over its hidden entries (its total counts against its cells), so a
 * hidden count is fixed when the equations, taken together, reduce to it
 * alone, however many lines that takes.
 */
function fixedBy(lines: readonly Line[], hidden: readonly boolean[]): number[] {
  const unknowns = hidden.flatMap((isHidden, index) => (isHidden ? [index] : []));
  const rows = lines
    .map(({ cells, total }) =>
      unknowns.map((index) => BigInt(cells.includes(index) ? 1 : index === total ? -1 : 0)),
    )
    .filter((row) => row.some((entry) => entry !== 0n));
  let pivots = 0;
  for (let column = 0; column < unknowns.length; column += 1) {
    const at = rows.findIndex((row, index) => index >= pivots && row[column] !== 0n);
    const pivot = rows[at];
    if (pivot === undefined) continue;
    rows[at] = rows[pivots] ?? pivot;
    rows[pivots] = pivot;
    for (const [index, row] of rows.entries()) {
      const factor = row[column] ?? 0n;
      if (index === pivots || factor === 0n) continue;
      const scaled = row.map(
        (entry, i) => entry * (pivot[column] ?? 1n) - (pivot[i] ?? 0n) * factor,
      );
      const divisor = scaled.reduce((d, entry) => gcd(d, entry), 0n);
      rows[index] = scaled.map((entry) => entry / (divisor || 1n));
    }
    pivots += 1;
  }
  return rows.flatMap((row) => {
    const set = row.flatMap((entry, i) => (entry === 0n ? [] : [i]));
    const only = set.length === 1 ? unknowns[set[0] ?? 0] : undefined;
    return only === undefined ? [] : [only];
  });
}

const gcd = (a: bigint, b: bigint): bigint => {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};
