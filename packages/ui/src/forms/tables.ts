// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the table question and the table answer share: reading rows and cells,
// naming a row, and writing a total.

import type { FormHelpers, FormMoney, TableColumnDefinition } from './types.ts';

export type Row = Readonly<Record<string, unknown>>;

/** The rows of a table answer. Anything that is not a list of rows shows as no rows. */
export function rowsOf(answer: unknown): Row[] {
  if (!Array.isArray(answer)) return [];
  return (answer as unknown[]).map((row) =>
    typeof row === 'object' && row !== null && !Array.isArray(row) ? (row as Row) : {},
  );
}

/** A cell's answer, or null when the row has none. */
export function cellOf(row: Row, column: Pick<TableColumnDefinition, 'id'>): unknown {
  return Object.hasOwn(row, column.id) ? row[column.id] : null;
}

/** Number and currency columns can be added up. */
export function isTotalled(column: TableColumnDefinition): boolean {
  return (column.type === 'number' || column.type === 'currency') && column.total === true;
}

/** The noun for many rows, as the engine's messages say it: "costs", "activities", "boxes". */
export function plural(noun: string): string {
  if (/(?:s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The text with its first letter in lower case, unless it starts with an acronym such as "VAT". */
function lowerFirst(text: string): string {
  return /^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/** "Total cost" for a column called "Cost". */
export function totalLabel(column: TableColumnDefinition): string {
  return `Total ${lowerFirst(column.label)}`;
}

/** Rounds off the noise in a sum of decimals, so 0.1 and 0.2 make 0.3. */
const totalFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 8 });

/** A total as people read it, or null when it could not be worked out. */
export function totalText(
  total: number | FormMoney | null | undefined,
  formatMoney: FormHelpers['formatMoney'],
): string | null {
  if (total === null || total === undefined) return null;
  return typeof total === 'number' ? totalFormat.format(total) : formatMoney(total);
}
