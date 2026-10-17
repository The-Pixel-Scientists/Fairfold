// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import type { ReactNode } from 'react';

import { cx } from '../cx.ts';
import { isMoney, isText, readNumber } from './read.ts';
import { cellOf, isTotalled, totalText } from './tables.ts';
import type { Row } from './tables.ts';
import type { AnswerHelpers, TableColumnDefinition, TableFieldDefinition } from './types.ts';

export interface AnswerTableProps {
  field: TableFieldDefinition;
  /** The rows to show: at least one. */
  rows: readonly Row[];
  /** `tableTotals` adds the totals row; without it a totalled column shows no total. */
  helpers: AnswerHelpers;
}

const cell = 'px-3 py-2 align-top';
const NOT_WORKED_OUT = 'Not worked out';

function isNumeric(column: TableColumnDefinition): boolean {
  return column.type === 'number' || column.type === 'currency';
}

/** What a cell says, or null when it is empty or does not fit its column. */
function cellText(
  column: TableColumnDefinition,
  value: unknown,
  formatMoney: AnswerHelpers['formatMoney'],
): string | null {
  switch (column.type) {
    case 'short_text':
      return isText(value) ? value : null;
    case 'number':
      return readNumber(value);
    case 'currency':
      return isMoney(value) ? formatMoney(value) : null;
    case 'dropdown':
      return isText(value)
        ? (column.options.find((option) => option.value === value)?.label ?? value)
        : null;
  }
}

/** The text, or a dash that a screen reader says as "Not answered". */
function orNothing(text: string | null): ReactNode {
  return (
    text ?? (
      <>
        <span aria-hidden="true" className="text-muted">
          –
        </span>
        <span className="sr-only">Not answered</span>
      </>
    )
  );
}

/**
 * A table question's answer as a table: the question is its caption, each
 * column has a heading, each answer row is a row, and the totals of totalled
 * columns sit in the footer. Numbers are right-aligned. A table wider than its
 * space scrolls inside a named region that a keyboard can reach, never the
 * page. The region is positioned, so visually hidden text in a far-right cell
 * stays inside it.
 */
export function AnswerTable({ field, rows, helpers }: AnswerTableProps) {
  const captionId = useId();
  const { columns } = field;
  const totals = helpers.tableTotals?.(field, rows) ?? {};
  const hasTotals = helpers.tableTotals !== undefined && columns.some(isTotalled);

  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className="relative overflow-x-auto"
    >
      <table className="min-w-full border-collapse text-body">
        <caption id={captionId} className="sr-only">
          {field.label}
        </caption>
        <thead>
          <tr className="border-b border-edge/40">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cx(
                  cell,
                  'text-sm font-medium text-muted',
                  isNumeric(column) ? 'text-end' : 'text-start',
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-divider">
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cx(
                    cell,
                    isNumeric(column)
                      ? 'whitespace-nowrap text-end tabular-nums'
                      : 'min-w-32 break-words',
                  )}
                >
                  {orNothing(cellText(column, cellOf(row, column), helpers.formatMoney))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr className="border-t border-edge/40 font-semibold">
              {columns.map((column, index) => {
                const total = isTotalled(column)
                  ? totalText(totals[column.id], helpers.formatMoney)
                  : null;
                const className = cx(
                  cell,
                  isNumeric(column) ? 'whitespace-nowrap text-end tabular-nums' : 'text-start',
                );
                // The first cell names the row; a totalled first column keeps its total beside the name.
                return index === 0 ? (
                  <th key={column.id} scope="row" className={className}>
                    {isTotalled(column) ? `Total: ${total ?? NOT_WORKED_OUT}` : 'Total'}
                  </th>
                ) : (
                  <td key={column.id} className={className}>
                    {isTotalled(column) ? (total ?? NOT_WORKED_OUT) : null}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
