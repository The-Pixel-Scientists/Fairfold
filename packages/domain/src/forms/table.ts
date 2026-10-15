// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The totals of a table question's totalled columns, worked out the same way
// wherever the table is shown. Blank cells count as nothing; a cell that is
// not a number, or not an amount in the column's currency, leaves its column
// with no total, so a wrong figure is never shown as a sum.

import { moneySchema, type Money } from '../platform/money.ts';
import type { TableColumn, TableField } from './definition.ts';

/** A number column's sum, a currency column's amount, or `null` when it cannot be worked out. */
export type TableTotal = number | Money | null;

/** A cell's number, in minor units for an amount, or undefined when it has none. */
function figure(column: TableColumn, cell: unknown): number | undefined {
  if (column.type === 'number') {
    return typeof cell === 'number' && Number.isFinite(cell) ? cell : undefined;
  }
  const money = moneySchema.safeParse(cell);
  const currency = column.type === 'currency' ? column.currency : undefined;
  return money.success && money.data.currency === currency ? money.data.amountMinor : undefined;
}

/** Each totalled number and currency column's total, keyed by column id. */
export function tableTotals(
  field: TableField,
  rows: readonly Readonly<Record<string, unknown>>[],
): Record<string, TableTotal> {
  const totals: Record<string, TableTotal> = {};
  for (const column of field.columns) {
    if (!column.total || (column.type !== 'number' && column.type !== 'currency')) continue;
    const figures = rows
      .map((row) => (Object.hasOwn(row, column.id) ? row[column.id] : null))
      .filter((cell) => cell !== null && cell !== undefined)
      .map((cell) => figure(column, cell));
    const sum = figures.reduce<number>((total, value) => total + (value ?? Number.NaN), 0);
    if (column.type === 'number') totals[column.id] = Number.isFinite(sum) ? sum : null;
    else {
      totals[column.id] = Number.isSafeInteger(sum)
        ? { amountMinor: sum, currency: column.currency }
        : null;
    }
  }
  return totals;
}
