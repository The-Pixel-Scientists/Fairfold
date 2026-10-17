// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a table question adds to a question: what a row is called, how many
// rows there may be, and its columns. A column's id is made when the column is
// added and never shown or changed, because every answer is kept under it.

import { CELL_MAX_CHARACTERS, TABLE_MAX_ROWS } from '@pixel-scientists/domain/forms';
import { Button, CheckboxGroup, FieldGroup, FormField, Input, Select } from '@pixel-scientists/ui';
import { useEffect, useId, useRef, useState } from 'react';

import { Arrange } from './Arrange.tsx';
import { OptionList } from './Choices.tsx';
import { MAX_COLUMNS, moved, newColumn, withColumnType } from './draft.ts';
import type { Column, TableQuestion } from './draft.ts';
import { Count, Settings } from './Settings.tsx';
import type { Errors } from './Settings.tsx';
import { columnTypes } from './words.ts';

function ColumnEditor({
  column,
  index,
  count,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  column: Column;
  /** From 0. */
  index: number;
  count: number;
  errors: Errors;
  onChange: (column: Column) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const path = `columns.${String(index)}`;
  const id = `field-columns-${String(index)}`;
  const canTotal = column.type === 'number' || column.type === 'currency';
  /** Each column's boxes are named apart for a screen reader that lists them without their group. */
  const named = (label: string) => (
    <>
      {label}
      <span className="sr-only"> of column {index + 1}</span>
    </>
  );
  return (
    <div className="rounded-md border border-divider p-3">
      <FieldGroup legend={`Column ${String(index + 1)}`}>
        <FormField id={`${id}-label`} label={named('Heading')} error={errors.get(`${path}.label`)}>
          <Input
            value={column.label}
            autoComplete="off"
            onChange={(event) => {
              onChange({ ...column, label: event.currentTarget.value });
            }}
          />
        </FormField>
        <FormField id={`${id}-type`} label={named('Type')} error={errors.get(`${path}.type`)}>
          <Select
            value={column.type}
            onChange={(event) => {
              const type = columnTypes.find(({ value }) => value === event.currentTarget.value);
              if (type !== undefined) onChange(withColumnType(column, type.value));
            }}
          >
            {columnTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </FormField>
        <CheckboxGroup
          id={`${id}-required`}
          legend="Required"
          name={`${id}-required`}
          values={column.required ? ['required'] : []}
          onValuesChange={(values) => {
            onChange({ ...column, required: values.includes('required') });
          }}
          options={[{ value: 'required', label: 'Applicants must fill this in on every row' }]}
          error={errors.get(`${path}.required`)}
        />
        {canTotal && (
          <CheckboxGroup
            id={`${id}-total`}
            legend="Total"
            name={`${id}-total`}
            values={column.total ? ['total'] : []}
            onValuesChange={(values) => {
              onChange({ ...column, total: values.includes('total') });
            }}
            options={[{ value: 'total', label: 'Add up this column under the table' }]}
            error={errors.get(`${path}.total`)}
          />
        )}
        {column.type === 'short_text' && (
          <Count
            id={`${id}-maxCharacters`}
            label={named('Character limit')}
            value={column.maxCharacters}
            max={CELL_MAX_CHARACTERS}
            error={errors.get(`${path}.maxCharacters`)}
            onChange={(maxCharacters) => {
              onChange({ ...column, maxCharacters });
            }}
          />
        )}
        {column.type === 'dropdown' && (
          <OptionList
            options={column.options}
            path={`${path}.options`}
            noun="column"
            errors={errors}
            onChange={(options) => {
              onChange({ ...column, options });
            }}
            onRemove={(value) => {
              onChange({
                ...column,
                options: column.options.filter((choice) => choice.value !== value),
              });
            }}
          />
        )}
        <Arrange
          id={id}
          name={`column ${String(index + 1)}`}
          position={index}
          count={count}
          keepsOne="A table keeps at least one column. Add another before you remove this one."
          onMove={onMove}
          onRemove={onRemove}
        />
      </FieldGroup>
    </div>
  );
}

/** A table question's rows and columns, which can be added, removed and moved with buttons. */
export function TableSettings({
  question,
  errors,
  onChange,
}: {
  question: TableQuestion;
  errors: Errors;
  onChange: (question: TableQuestion) => void;
}) {
  const { columns } = question;
  const limitId = useId();
  const focus = useRef<string | null>(null);
  const [said, setSaid] = useState('');

  useEffect(() => {
    if (focus.current === null) return;
    document.getElementById(focus.current)?.focus();
    focus.current = null;
  }, [columns]);

  const change = (next: readonly Column[], say: string) => {
    setSaid(say);
    onChange({ ...question, columns: [...next] });
  };

  return (
    <>
      <Settings heading="Rows">
        <FormField
          id="field-rowNoun"
          label="Name for one row"
          hint="Write it as one, such as “cost” or “activity”. Applicants see it in “Add another cost”."
          error={errors.get('rowNoun')}
        >
          <Input
            value={question.rowNoun}
            autoComplete="off"
            onChange={(event) => {
              onChange({ ...question, rowNoun: event.currentTarget.value });
            }}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <Count
            id="field-minRows"
            label="Fewest rows"
            value={question.minRows}
            max={TABLE_MAX_ROWS}
            error={errors.get('minRows')}
            onChange={(minRows) => {
              onChange({ ...question, minRows });
            }}
          />
          <Count
            id="field-maxRows"
            label="Most rows"
            value={question.maxRows}
            max={TABLE_MAX_ROWS}
            error={errors.get('maxRows')}
            onChange={(maxRows) => {
              onChange({ ...question, maxRows });
            }}
          />
        </div>
      </Settings>
      <Settings heading="Columns">
        {errors.has('columns') && (
          <p className="text-body font-medium text-danger">
            <span className="sr-only">Error:</span> {errors.get('columns')}
          </p>
        )}
        {columns.map((column, index) => (
          <ColumnEditor
            key={column.id}
            column={column}
            index={index}
            count={columns.length}
            errors={errors}
            onChange={(next) => {
              onChange({
                ...question,
                columns: columns.map((item) => (item.id === next.id ? next : item)),
              });
            }}
            onMove={(by) => {
              focus.current = `field-columns-${String(index + by)}-${by === -1 ? 'up' : 'down'}`;
              change(
                moved(columns, index, by),
                `Column moved to position ${String(index + by + 1)} of ${String(columns.length)}`,
              );
            }}
            onRemove={() => {
              focus.current = `field-columns-${String(Math.min(index, columns.length - 2))}-label`;
              change(
                columns.filter((_, position) => position !== index),
                'Column removed',
              );
            }}
          />
        ))}
        <Button
          id="field-columns-add"
          className="self-start"
          aria-disabled={columns.length >= MAX_COLUMNS || undefined}
          aria-describedby={limitId}
          onClick={() => {
            if (columns.length >= MAX_COLUMNS) return;
            focus.current = `field-columns-${String(columns.length)}-label`;
            change([...columns, newColumn()], 'Column added');
          }}
        >
          Add column
        </Button>
        <p id={limitId} className="text-sm text-muted">
          A table has 1 to {MAX_COLUMNS} columns.
        </p>
        <p role="status" className="sr-only">
          {said}
        </p>
      </Settings>
    </>
  );
}
