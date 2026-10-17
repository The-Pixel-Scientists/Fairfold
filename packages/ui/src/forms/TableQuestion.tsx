// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { FieldProblemLike } from '../auth/problems.ts';
import { Button } from '../Button.tsx';
import { cx } from '../cx.ts';
import { FormField, Input, Select } from '../FormField.tsx';
import { CurrencyInput, NumberInput } from './NumberInput.tsx';
import { capitalise, cellOf, isTotalled, plural, rowsOf, totalLabel, totalText } from './tables.ts';
import type { Row } from './tables.ts';
import { ANNOUNCE_AFTER_MS } from './TextCount.tsx';
import type { QuestionHelpers, TableColumnDefinition, TableFieldDefinition } from './types.ts';

export interface TableQuestionProps {
  field: TableFieldDefinition;
  /** The question with its requirement in words. It names the group. */
  legend: ReactNode;
  /** The rows, each an object keyed by column id. Anything else shows as no rows. */
  value: unknown;
  /** The problems with the table as a whole, named by the field id, and with its cells, such as `f_budget.2.c_cost`. */
  problems: readonly FieldProblemLike[];
  /** Called with the new rows, or null when none are left. */
  onChange: (answer: unknown) => void;
  /** Without `tableTotals` and `formatMoney` the rows show no totals. */
  helpers: Pick<QuestionHelpers, 'formatMoney' | 'tableTotals'>;
}

/** With more columns than this a row's fields stay stacked, however wide the space. */
const MOST_COLUMNS_SIDE_BY_SIDE = 4;
const NOT_WORKED_OUT = 'Not worked out yet';

const cellId = (field: TableFieldDefinition, row: number, column: TableColumnDefinition) =>
  `${field.id}-${String(row)}-${column.id}`;
const removeId = (field: TableFieldDefinition, row: number) => `${field.id}-${String(row)}-remove`;
const addId = (field: TableFieldDefinition) => `${field.id}-add`;

const isNumeric = (column: TableColumnDefinition) =>
  column.type === 'number' || column.type === 'currency';

/** How wide a column is when a row's fields sit side by side: numbers fit their figures, text shares the rest. */
function widthOf(column: TableColumnDefinition): string {
  if (column.type === 'number') return '@lg:w-28 @lg:shrink-0';
  if (column.type === 'currency') return '@lg:w-36 @lg:shrink-0';
  return '@lg:min-w-0 @lg:flex-1';
}

interface CellProps {
  id: string;
  column: TableColumnDefinition;
  value: unknown;
  error: string | undefined;
  sideBySide: boolean;
  onChange: (answer: unknown) => void;
}

/**
 * One cell, as the control that suits its column. Its label is its column's
 * heading, shown with it when the fields are stacked and left to the heading
 * row above when they sit side by side.
 */
function Cell({ id, column, value, error, sideBySide, onChange }: CellProps) {
  const text = typeof value === 'string' ? value : '';
  const onType = (event: { currentTarget: { value: string } }) => {
    onChange(event.currentTarget.value === '' ? null : event.currentTarget.value);
  };
  const figures = 'text-end tabular-nums';

  return (
    <FormField
      id={id}
      label={
        <span className={cx(sideBySide && '@lg:sr-only')}>
          {column.label}
          {!column.required && ' (optional)'}
        </span>
      }
      error={error}
      className={cx(
        // Side by side, the error sits under its box, and the bar beside it would push the column out of line.
        sideBySide &&
          '@lg:gap-0 @lg:border-l-0 @lg:pl-0 @lg:[&>[id$=-error]]:order-last @lg:[&>[id$=-error]]:mt-1',
        sideBySide && widthOf(column),
      )}
    >
      {column.type === 'short_text' && <Input value={text} autoComplete="off" onChange={onType} />}
      {column.type === 'number' && (
        <NumberInput
          value={value}
          wholeNumber={column.wholeNumber}
          onChange={onChange}
          className={figures}
        />
      )}
      {column.type === 'currency' && (
        <CurrencyInput value={value} onChange={onChange} className={figures} />
      )}
      {column.type === 'dropdown' && (
        <Select value={text} onChange={onType}>
          <option value="">Choose an option</option>
          {column.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}

interface TotalLine {
  id: string;
  label: string;
  text: string | null;
}

/**
 * The totals as they stand, shown at once. A screen reader hears them from a
 * polite live region once typing stops, not at every key.
 */
function Totals({ lines }: { lines: readonly TotalLine[] }) {
  const spoken = lines.map(({ label, text }) => `${label}: ${text ?? NOT_WORKED_OUT}`).join('. ');
  const [announced, setAnnounced] = useState(spoken);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnnounced(spoken);
    }, ANNOUNCE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [spoken]);

  return (
    <>
      <div aria-hidden="true" className="flex flex-col gap-1 border-t border-edge/40 pt-3">
        {lines.map(({ id, label, text }) => (
          <p
            key={id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 text-lg font-semibold text-ink"
          >
            <span>{label}</span>
            <span className={cx('tabular-nums', text === null && 'font-medium text-muted')}>
              {text ?? NOT_WORKED_OUT}
            </span>
          </p>
        ))}
      </div>
      <div role="status" className="sr-only">
        {announced}
      </div>
    </>
  );
}

/**
 * A table question, answered one row at a time. Each row is a group named by
 * the noun and its number ("Cost 2") with one control per column. From a
 * medium width a row's fields sit side by side under the column headings;
 * below that each field stands alone with its own label, so a phone never
 * scrolls sideways. Adding a row moves focus to its first control; removing
 * one moves it to the same place in the next row, or to the add button.
 * Totalled columns show their total below the rows.
 */
export function TableQuestion({
  field,
  legend,
  value,
  problems,
  onChange,
  helpers,
}: TableQuestionProps) {
  const { columns, rowNoun: noun, maxRows, minRows } = field;
  const answered = rowsOf(value);
  // The fewest rows show from the start, and become part of the answer when one is changed.
  const rows: Row[] =
    answered.length >= minRows
      ? answered
      : [...answered, ...Array.from({ length: minRows - answered.length }, (): Row => ({}))];
  const sideBySide = columns.length <= MOST_COLUMNS_SIDE_BY_SIDE;
  const removable = rows.length > minRows;

  const tableProblems = problems.filter((problem) => problem.field === field.id);
  const hintId = `${field.id}-hint`;
  const errorId = `${field.id}-error`;
  const describedBy =
    [field.hint === undefined ? null : hintId, tableProblems.length > 0 ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const focusAfter = useRef<readonly string[]>([]);
  useEffect(() => {
    if (focusAfter.current.length === 0) return;
    const target = focusAfter.current
      .map((id) => document.getElementById(id))
      .find((element) => element !== null);
    focusAfter.current = [];
    target?.focus();
  });

  const change = (next: readonly Row[]) => {
    onChange(next.length === 0 ? null : next);
  };
  const edit = (index: number, column: TableColumnDefinition, answer: unknown) => {
    change(rows.map((row, at) => (at === index ? { ...row, [column.id]: answer } : row)));
  };
  const add = () => {
    const [first] = columns;
    focusAfter.current = first === undefined ? [] : [cellId(field, rows.length + 1, first)];
    change([...rows, {}]);
  };
  const remove = (index: number) => {
    // The next row moves up into this place; with none left, the add button is the place.
    focusAfter.current = [removeId(field, index + 1), addId(field)];
    change(rows.filter((_, at) => at !== index));
  };

  const { formatMoney, tableTotals } = helpers;
  const totals = tableTotals?.(field, rows) ?? {};
  const lines: TotalLine[] =
    formatMoney === undefined || tableTotals === undefined
      ? []
      : columns.filter(isTotalled).map((column) => ({
          id: column.id,
          label: totalLabel(column),
          text: totalText(totals[column.id], formatMoney),
        }));

  return (
    <fieldset
      id={field.id}
      aria-describedby={describedBy}
      className={cx(
        'flex min-w-0 flex-col gap-field-gap',
        tableProblems.length > 0 && 'border-l-4 border-danger pl-3',
      )}
    >
      <legend className="text-body font-medium text-ink">{legend}</legend>
      {field.hint !== undefined && (
        <p id={hintId} className="text-body text-muted">
          {field.hint}
        </p>
      )}
      {tableProblems.length > 0 && (
        <div id={errorId} className="flex flex-col gap-1 text-body font-medium text-danger">
          {tableProblems.map((problem) => (
            <p key={problem.message}>
              <span className="sr-only">Error:</span> {problem.message}
            </p>
          ))}
        </div>
      )}
      <div className="@container flex flex-col gap-4">
        {rows.length === 0 && (
          <p className="text-body text-muted">No {plural(noun)} yet. Add the first one below.</p>
        )}
        {sideBySide && rows.length > 0 && (
          <div
            aria-hidden="true"
            className="hidden gap-x-3 border-b border-divider pb-2 text-sm font-medium text-muted @lg:flex"
          >
            {columns.map((column) => (
              <span
                key={column.id}
                className={cx(widthOf(column), isNumeric(column) && 'text-end')}
              >
                {column.label}
                {!column.required && ' (optional)'}
              </span>
            ))}
            {removable && <span className="w-24 shrink-0" />}
          </div>
        )}
        <div>
          {rows.map((row, index) => {
            const number = index + 1;
            const name = `${noun} ${String(number)}`;
            return (
              // Rows have no identity of their own: a row is where it stands. The divider is
              // on a wrapper, because a fieldset's own top border runs through its legend.
              <div
                key={number}
                className="border-t border-divider py-4 first:border-t-0 first:pt-0"
              >
                <fieldset className="min-w-0">
                  <legend
                    className={cx(
                      'pb-3 text-sm font-medium text-muted',
                      sideBySide && '@lg:sr-only',
                    )}
                  >
                    {capitalise(name)}
                  </legend>
                  <div
                    className={cx(
                      'flex flex-col gap-4',
                      sideBySide && '@lg:flex-row @lg:items-start @lg:gap-3',
                    )}
                  >
                    {columns.map((column) => (
                      <Cell
                        key={column.id}
                        id={cellId(field, number, column)}
                        column={column}
                        value={cellOf(row, column)}
                        error={
                          problems.find(
                            (problem) =>
                              problem.field === `${field.id}.${String(number)}.${column.id}`,
                          )?.message
                        }
                        sideBySide={sideBySide}
                        onChange={(answer) => {
                          edit(index, column, answer);
                        }}
                      />
                    ))}
                    {removable && (
                      <Button
                        id={removeId(field, number)}
                        variant="quiet"
                        className={cx('self-start', sideBySide && '@lg:w-24 @lg:shrink-0')}
                        onClick={() => {
                          remove(index);
                        }}
                      >
                        Remove <span className="sr-only">{name}</span>
                      </Button>
                    )}
                  </div>
                </fieldset>
              </div>
            );
          })}
        </div>
        {rows.length < maxRows ? (
          <div>
            <Button id={addId(field)} onClick={add}>
              {rows.length === 0 ? `Add the first ${noun}` : `Add another ${noun}`}
            </Button>
          </div>
        ) : (
          <p className="text-body text-muted">
            You can add up to {maxRows.toLocaleString('en-GB')} {plural(noun)}.
          </p>
        )}
        {lines.length > 0 && rows.length > 0 && <Totals lines={lines} />}
      </div>
    </fieldset>
  );
}
