// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId } from 'react';
import type { ReactNode } from 'react';

import { cx } from '../cx.ts';

export interface Column<Row> {
  /** Names the column. `sort` and `onSortChange` use it. */
  key: string;
  /** The heading, in sentence case and a word or two, such as "Amount requested". */
  header: ReactNode;
  /** What the column shows for a row. */
  cell: (row: Row) => ReactNode;
  /** `end` for numbers, amounts and anything else that should line up on the right. */
  align?: 'start' | 'end';
  /** Turns the heading into a button that sorts by this column. */
  sortable?: boolean;
  /** The column names each row, so a screen reader reads it with every other cell. Use it once. */
  rowHeader?: boolean;
}

export interface SortState {
  key: string;
  direction: 'ascending' | 'descending';
}

export interface DataTableProps<Row> {
  /** Names the table, such as "Applications in the Spring round". */
  caption: string;
  /** Keeps the caption for screen readers only, when a heading already says it. */
  captionHidden?: boolean;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  /** A value that is unique to each row and does not change when the rows are sorted. */
  rowKey: (row: Row) => string;
  /** The sorted column, shown in its heading and to assistive technology. */
  sort?: SortState;
  /** Called when a sortable heading is pressed. The table does not reorder rows; do that with the new sort. */
  onSortChange?: (sort: SortState) => void;
  /** Shown in place of the rows when there are none: what is empty and what to do next. */
  empty?: ReactNode;
}

const cell = 'px-3 py-2 whitespace-nowrap';

function SortIcon({ direction }: { direction: SortState['direction'] | undefined }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cx('size-3.5 shrink-0', direction === undefined && 'opacity-50')}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === 'ascending' ? (
        <path d="M8 13V3M4 7l4-4 4 4" />
      ) : direction === 'descending' ? (
        <path d="M8 3v10M4 9l4 4 4-4" />
      ) : (
        <path d="M5 6.5l3-3 3 3M5 9.5l3 3 3-3" />
      )}
    </svg>
  );
}

/**
 * A table for staff to scan and sort. It sits in a named, focusable region
 * that scrolls sideways, so a wide table never widens the page and a keyboard
 * user can scroll it. The region is positioned, so visually hidden text in a
 * far-right cell stays inside it. A sortable heading is a button, and the sorted column
 * is marked with `aria-sort` and an arrow. Cells do not wrap, so give a long
 * cell its own wrapping element. Sorting is yours to do: the table shows the
 * rows in the order it is given. It fills the width of its parent, so put it
 * in a block or a column, not in a row that sizes itself to its content.
 */
export function DataTable<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  empty,
}: DataTableProps<Row>) {
  const captionId = useId();

  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className="@container relative overflow-x-auto"
    >
      <table className="min-w-full border-collapse text-body">
        <caption
          id={captionId}
          className={cx(
            'caption-top text-start',
            captionHidden
              ? 'sr-only'
              : 'w-[100cqw] pb-2 text-lg font-semibold tracking-tight text-ink',
          )}
        >
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-edge/40">
            {columns.map((column) => {
              const direction = sort?.key === column.key ? sort.direction : undefined;
              const end = column.align === 'end';
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={direction}
                  className={cx(
                    cell,
                    'text-sm font-medium',
                    direction === undefined ? 'text-muted' : 'text-ink',
                    end ? 'text-end' : 'text-start',
                  )}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => {
                        onSortChange?.({
                          key: column.key,
                          direction: direction === 'ascending' ? 'descending' : 'ascending',
                        });
                      }}
                      className={cx(
                        '-mx-1 inline-flex min-h-target items-center gap-1 rounded-sm px-1 font-medium',
                        'transition-colors duration-(--motion-fast) ease-standard hover:text-ink',
                        end && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      <SortIcon direction={direction} />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-divider transition-colors duration-(--motion-fast) ease-standard hover:bg-sunken/60"
            >
              {columns.map((column) => {
                const className = cx(
                  cell,
                  column.align === 'end' ? 'text-end tabular-nums' : 'text-start',
                );
                return column.rowHeader ? (
                  <th key={column.key} scope="row" className={cx(className, 'font-medium')}>
                    {column.cell(row)}
                  </th>
                ) : (
                  <td key={column.key} className={className}>
                    {column.cell(row)}
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && empty !== undefined && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
