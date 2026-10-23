// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { Checkbox } from '../Checkbox.tsx';
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

/** Tick boxes for choosing rows, to act on several at once. */
export interface RowSelection<Row> {
  /** The `rowKey` of each row chosen. */
  selected: ReadonlySet<string>;
  onSelectedChange: (selected: ReadonlySet<string>) => void;
  /** Names a row's box by what ticking it chooses, such as "Select Riverside Lunch Club". */
  label: (row: Row) => string;
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
  /** Adds a box to each row and one in the heading that chooses every row shown. Space chooses the focused row. */
  selection?: RowSelection<Row>;
  /** Called when Enter is pressed on a focused row. Give a row a link as well, for a pointer. */
  onOpenRow?: (row: Row) => void;
  /** Called when "?" is pressed on a focused row, to show the keyboard shortcuts. */
  onHelp?: () => void;
}

/** What a person can Tab to inside a row. */
const CONTROLS = 'a[href], button, input, select, textarea';

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
  selection,
  onOpenRow,
  onHelp,
}: DataTableProps<Row>) {
  const captionId = useId();
  const body = useRef<HTMLTableSectionElement>(null);
  const [current, setCurrent] = useState(0);
  const roving = selection !== undefined || onOpenRow !== undefined;
  const active = Math.min(current, Math.max(rows.length - 1, 0));
  const keys = rows.map(rowKey);
  const chosen = keys.filter((key) => selection?.selected.has(key));

  // Roving focus: Tab stops at the focused row, then at what is inside it, and skips every other row's controls.
  useLayoutEffect(() => {
    if (!roving) return;
    body.current?.querySelectorAll<HTMLElement>(':scope > tr[data-row]').forEach((row, index) => {
      for (const control of row.querySelectorAll<HTMLElement>(CONTROLS)) {
        if (index !== active) {
          control.tabIndex = -1;
          control.dataset['roving'] = '';
        } else if (control.dataset['roving'] !== undefined) {
          control.removeAttribute('tabindex');
          delete control.dataset['roving'];
        }
      }
    });
  });

  function focusRow(index: number) {
    const target = body.current?.querySelectorAll<HTMLElement>(':scope > tr[data-row]')[index];
    target?.focus();
  }

  function toggle(key: string, on: boolean) {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (on) next.add(key);
    else next.delete(key);
    selection.onSelectedChange(next);
  }

  function handleKey(event: KeyboardEvent<HTMLTableRowElement>, index: number, row: Row) {
    // Keys pressed on a link or box inside the row are theirs.
    if (event.target !== event.currentTarget) return;
    const last = rows.length - 1;
    const key = keys[index] ?? '';
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(Math.min(index + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        focusRow(0);
        break;
      case 'End':
        event.preventDefault();
        focusRow(last);
        break;
      case 'Enter':
        if (onOpenRow) {
          event.preventDefault();
          onOpenRow(row);
        }
        break;
      case ' ':
        if (selection) {
          event.preventDefault();
          toggle(key, !selection.selected.has(key));
        }
        break;
      case '?':
        if (onHelp) {
          event.preventDefault();
          onHelp();
        }
        break;
      default:
    }
  }

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
            {selection && (
              <th scope="col" className={cx(cell, 'w-0')}>
                <Checkbox
                  label="Select all on this page"
                  labelHidden
                  checked={rows.length > 0 && chosen.length === rows.length}
                  indeterminate={chosen.length > 0 && chosen.length < rows.length}
                  onCheckedChange={(on) => {
                    const next = new Set(selection.selected);
                    for (const key of keys) {
                      if (on) next.add(key);
                      else next.delete(key);
                    }
                    selection.onSelectedChange(next);
                  }}
                />
              </th>
            )}
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
        <tbody ref={body}>
          {rows.map((row, index) => (
            <tr
              key={keys[index]}
              data-row=""
              {...(roving && {
                tabIndex: index === active ? 0 : -1,
                onFocus: () => {
                  setCurrent(index);
                },
                onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
                  handleKey(event, index, row);
                },
              })}
              className={cx(
                'border-b border-divider transition-colors duration-(--motion-fast) ease-standard',
                selection?.selected.has(keys[index] ?? '')
                  ? 'bg-accent-soft/60'
                  : 'hover:bg-sunken/60',
                roving && '-outline-offset-2',
              )}
            >
              {selection && (
                <td className={cx(cell, 'w-0')}>
                  <Checkbox
                    label={selection.label(row)}
                    labelHidden
                    checked={selection.selected.has(keys[index] ?? '')}
                    onCheckedChange={(on) => {
                      toggle(keys[index] ?? '', on);
                    }}
                  />
                </td>
              )}
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
              <td colSpan={columns.length + (selection ? 1 : 0)} className="px-3 py-8">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
