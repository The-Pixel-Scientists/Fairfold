// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The suppression function over tables of counts (ADR 0032, rules 1 to 4):
// named cases, then a property run that checks every output against the
// contract's own response schema and against the idea of the rules: no shown
// count is small, and no hidden cell can be worked out from a line.

import { describe, expect, it } from 'vitest';

import { disclosureFloor, monitoringReportSchema } from '../contracts/index.ts';
import { disclose, type CountTable, type Disclosed } from './suppress.ts';

const rule = disclosureFloor;
const HIDDEN = { suppressed: true };
const shown = (count: number) => ({ suppressed: false, count });

const oneWay = (...counts: number[]): CountTable => ({
  breakdown: null,
  columns: [],
  rows: counts.map((count, index) => ({ option: `option_${String(index)}`, cells: [count] })),
  respondents: counts.reduce((total, count) => total + count, 0),
});

const twoWay = (
  breakdown: 'outcome' | 'stage_reached',
  columns: string[],
  ...rows: number[][]
): CountTable => ({
  breakdown,
  columns,
  rows: rows.map((cells, index) => ({ option: `option_${String(index)}`, cells })),
  respondents: rows.flat().reduce((total, count) => total + count, 0),
});

function table(result: Disclosed) {
  if (result.status !== 'shown') throw new Error('The table was withheld.');
  return result.table;
}

/** The counts a table shows, hidden cells as null: its cells, then each row's total, then the totals row. */
const view = (result: Disclosed) => {
  const { rows, totals } = table(result);
  const pick = (cell: { suppressed: boolean; count?: number }) =>
    cell.suppressed ? null : cell.count;
  return [...rows, totals].map((line) => [...line.cells, line.total].map(pick));
};

/** The grid of a response: each row's cells and total, then the totals row. */
function grid(result: Disclosed) {
  const { rows, totals } = table(result);
  return [...rows, totals].map((line) => [...line.cells, line.total]);
}

/** The rank of a matrix of small integers, by elimination in floating point. */
function rank(matrix: number[][]): number {
  const rows = matrix.map((row) => [...row]);
  let done = 0;
  for (let column = 0; column < (rows[0]?.length ?? 0); column += 1) {
    const at = rows.findIndex((row, i) => i >= done && Math.abs(row[column] ?? 0) > 1e-9);
    const pivot = rows[at];
    if (pivot === undefined) continue;
    rows[at] = rows[done] ?? pivot;
    rows[done] = pivot;
    for (const [i, row] of rows.entries()) {
      const factor = (row[column] ?? 0) / (pivot[column] ?? 1);
      if (i !== done) rows[i] = row.map((entry, k) => entry - factor * (pivot[k] ?? 0));
    }
    done += 1;
  }
  return done;
}

/**
 * The hidden cells that the shown figures fix, however many rows and columns
 * it takes. A hidden cell is fixed when dropping its column from the
 * equations (each line's cells less its total, zero) lowers their rank.
 */
function fixedCells(hidden: boolean[][]): string[] {
  const height = hidden.length;
  const width = hidden[0]?.length ?? 0;
  const unknowns = hidden.flatMap((row, r) => row.flatMap((h, c) => (h ? [[r, c] as const] : [])));
  const lines = [
    ...(width > 1 ? hidden.map((_, r) => ({ r })) : []),
    ...Array.from({ length: width }, (_, c) => ({ c })),
  ].map((line) =>
    unknowns.map(([r, c]) => {
      if ('r' in line) return r !== line.r ? 0 : c === width - 1 ? -1 : 1;
      return c !== line.c ? 0 : r === height - 1 ? -1 : 1;
    }),
  );
  const full = rank(lines);
  return unknowns
    .filter((_, i) => rank(lines.map((row) => row.filter((__, k) => k !== i))) < full)
    .map(([r, c]) => `${String(r)},${String(c)}`);
}

/** The reasons a table is unsafe, found without the function's own helpers. */
function problems(input: CountTable, result: Disclosed, threshold: number): string[] {
  if (result.status === 'withheld') return [];
  const found: string[] = [];
  const raw = [
    ...input.rows.map(({ cells }) =>
      input.columns.length === 0 ? cells : [...cells, cells.reduce((a, b) => a + b, 0)],
    ),
  ];
  const width = input.columns.length + 1;
  raw.push(
    Array.from({ length: width }, (_, column) => raw.reduce((t, row) => t + (row[column] ?? 0), 0)),
  );
  const shownGrid = grid(result);
  const lines: { row?: number; column?: number }[] = [
    ...(input.columns.length > 0 ? raw.map((_, row) => ({ row })) : []),
    ...Array.from({ length: width }, (_, column) => ({ column })),
  ];
  for (const line of lines) {
    const at = (index: number) =>
      line.row === undefined ? ([index, line.column ?? 0] as const) : ([line.row, index] as const);
    const size = line.row === undefined ? raw.length : width;
    const elements = Array.from({ length: size }, (_, index) => {
      const [row, column] = at(index);
      return {
        hidden: shownGrid[row]?.[column]?.suppressed === true,
        value: raw[row]?.[column] ?? 0,
      };
    });
    const total = elements.at(-1);
    const cells = elements.slice(0, -1);
    const unknown = elements.filter((element) => element.hidden).length;
    if (unknown === 1) found.push('one unknown in a line');
    const hiddenSum = cells.filter((c) => c.hidden).reduce((t, c) => t + c.value, 0);
    if (total?.hidden === false && unknown > 0 && hiddenSum < threshold) {
      found.push('hidden cells below the threshold beside a shown total');
    }
  }
  const fixed = fixedCells(shownGrid.map((cells) => cells.map((cell) => cell.suppressed)));
  if (fixed.length > 0) found.push(`hidden cells fixed by the totals: ${fixed.join(' ')}`);
  for (const [row, cells] of shownGrid.entries()) {
    for (const [column, cell] of cells.entries()) {
      const count = cell.suppressed ? 0 : cell.count;
      if (count > 0 && count < threshold) found.push('a small count is shown');
      if (!cell.suppressed && count !== raw[row]?.[column]) found.push('a shown count changed');
    }
  }
  return found;
}

const envelope = (result: Disclosed, breakdown: 'outcome' | 'stage_reached' | null) => ({
  runId: crypto.randomUUID(),
  reportId: crypto.randomUUID(),
  reportVersion: 1,
  question: 'f_group',
  breakdown,
  filter: null,
  disclosureRule: { version: null, ...rule },
  result,
});

describe('a one-way table', () => {
  it('hides a small count and the next smallest, so the total cannot give it away', () => {
    const result = disclose(oneWay(50, 3, 30, 20), rule);

    expect(view(result)).toEqual([[50], [null], [30], [null], [103]]);
    expect(problems(oneWay(50, 3, 30, 20), result, rule.threshold)).toEqual([]);
  });

  it('keeps hiding while the hidden cells hold fewer people than the threshold', () => {
    const result = disclose(oneWay(50, 3, 4), rule);

    expect(view(result)).toEqual([[null], [null], [null], [57]]);
  });

  it('shows every count of a table with no small cell, and zero', () => {
    const result = disclose(oneWay(50, 0, 30), rule);

    expect(view(result)).toEqual([[50], [0], [30], [80]]);
  });

  it('treats prefer not to say like any other option', () => {
    const input = oneWay(40, 6, 30);
    const result = disclose(
      {
        ...input,
        rows: input.rows.map((row, i) => (i === 1 ? { ...row, option: 'prefer_not_to_say' } : row)),
      },
      rule,
    );

    expect(table(result).rows[1]).toMatchObject({ option: 'prefer_not_to_say', total: HIDDEN });
  });
});

describe('a two-way table', () => {
  it('hides across rows and columns until no hidden cell can be worked out', () => {
    const input = twoWay('stage_reached', ['s1', 's2'], [30, 5], [20, 25]);
    const result = disclose(input, rule);

    expect(view(result)).toEqual([
      [null, null, 35],
      [null, null, 45],
      [50, 30, 80],
    ]);
    expect(problems(input, result, rule.threshold)).toEqual([]);
  });

  it('hides a margin as well as a cell when that is what protects it', () => {
    const input = twoWay('stage_reached', ['x', 'y'], [12, 8], [40, 0]);
    const result = disclose(input, rule);

    expect(table(result).totals.cells[1]).toEqual(HIDDEN);
    expect(problems(input, result, rule.threshold)).toEqual([]);
  });

  it('hides a cell that holds all or none of its group on a breakdown by outcome', () => {
    const input = twoWay('outcome', ['funded', 'declined'], [15, 25], [0, 30]);
    const result = disclose(input, rule);

    expect(table(result).rows[1]).toMatchObject({ cells: [HIDDEN, HIDDEN] });
    expect(problems(input, result, rule.threshold)).toEqual([]);
  });

  it('hides a cell that several rows and columns together would give away', () => {
    const input = twoWay(
      'outcome',
      ['c0', 'c1', 'c2', 'c3'],
      [59, 1, 55, 1],
      [51, 57, 19, 21],
      [31, 57, 7, 9],
      [19, 5, 55, 21],
      [31, 9, 39, 49],
    );
    const result = disclose(input, rule);

    expect(problems(input, result, rule.threshold)).toEqual([]);
    if (result.status === 'shown') expect(table(result).rows[0]?.cells[1]).toEqual(HIDDEN);
  });

  it('shows a table with no small cell as it is', () => {
    const result = disclose(twoWay('outcome', ['funded', 'declined'], [15, 25], [20, 30]), rule);

    expect(view(result)).toEqual([
      [15, 25, 40],
      [20, 30, 50],
      [35, 55, 90],
    ]);
  });
});

describe('the minimum group', () => {
  it('withholds a table over fewer responses than the minimum group, and keeps nothing', () => {
    const result = disclose(oneWay(8, 11), rule);

    expect(result).toEqual({ status: 'withheld' });
  });

  it('withholds when the responses are fewer, even if the answers add up to more', () => {
    expect(disclose({ ...oneWay(30, 30), respondents: 19 }, rule)).toEqual({ status: 'withheld' });
  });

  it('shows a table at exactly the minimum group', () => {
    expect(disclose(oneWay(10, 10), rule)).toMatchObject({ status: 'shown' });
  });

  it('applies a threshold and group a tenant raised', () => {
    const raised = { threshold: 15, minimumGroup: 40 };

    expect(view(disclose(oneWay(14, 30, 30), raised))).toEqual([[null], [null], [30], [74]]);
    expect(disclose(oneWay(14, 20), raised)).toEqual({ status: 'withheld' });
  });
});

describe('a marker', () => {
  it('carries nothing but that it is suppressed', () => {
    const text = JSON.stringify(disclose(oneWay(50, 3, 30, 20), rule));

    expect(text).not.toMatch(/"count":3\b|"count":20\b/);
    expect(table(disclose(oneWay(50, 3, 30, 20), rule)).rows[1]?.total).toEqual(HIDDEN);
    expect(table(disclose(oneWay(50, 3, 30, 20), rule)).rows[0]?.total).toEqual(shown(50));
  });
});

/** A small deterministic generator, so a failure repeats. */
function random(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % below;
  };
}

const RUNS = 3000;

describe('random tables', () => {
  it('never show a small count, give no hidden cell away and validate as responses', () => {
    const next = random(20_261_118);
    let shownTables = 0;
    let unsafe = 0;
    for (let run = 0; run < RUNS; run += 1) {
      const threshold = 10 + next(6);
      const roll = { threshold, minimumGroup: threshold + 10 + next(10) };
      const columns = next(3) === 0 ? 0 : 1 + next(4);
      const breakdown = columns === 0 ? null : next(2) === 0 ? 'outcome' : 'stage_reached';
      const cell = () => (next(3) === 0 ? next(threshold + 3) : next(80));
      const input: CountTable = {
        breakdown,
        columns: Array.from({ length: columns }, (_, index) => `column_${String(index)}`),
        rows: Array.from({ length: 1 + next(5) }, (_, index) => ({
          option: `option_${String(index)}`,
          cells: Array.from({ length: Math.max(columns, 1) }, cell),
        })),
        respondents: 0,
      };
      const everything = input.rows.flatMap((row) => row.cells).reduce((a, b) => a + b, 0);
      const counted = { ...input, respondents: everything + next(5) };

      const result = disclose(counted, roll);

      expect(problems(counted, result, threshold), JSON.stringify(counted)).toEqual([]);
      if (result.status === 'shown') {
        shownTables += 1;
        const parsed = monitoringReportSchema.safeParse({
          ...envelope(result, breakdown),
          disclosureRule: { version: null, ...roll },
        });
        expect(parsed.success, JSON.stringify(counted)).toBe(true);
      } else if (Math.min(everything, counted.respondents) >= roll.minimumGroup) {
        unsafe += 1;
      }
    }
    expect(shownTables).toBeGreaterThan(500);
    // A table withheld for want of a safe way to show it is rare.
    expect(unsafe).toBeLessThan(RUNS / 20);
  });
});
