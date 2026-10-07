// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  CheckboxGroup,
  FieldGroup,
  FormField,
  Input,
  Panel,
  Select,
  Textarea,
} from '@pixel-scientists/ui';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

import { conditions, fileTypes, questionTypes, visibilities } from './formData.ts';
import type { BudgetColumn, FormQuestion } from './formData.ts';

const columnKinds = [{ value: 'text' }, { value: 'currency' }] as const;

const digits = (text: string): number => Number(text.replace(/\D/g, ''));

/** The option whose value is `value`, so a Select's text never needs a cast. */
function choose<T extends string>(options: readonly { value: T }[], value: string): T | undefined {
  return options.find((option) => option.value === value)?.value;
}

const notes: Partial<Record<FormQuestion['type'], string>> = {
  short_text: 'Applicants type a short answer on one line.',
  number: 'Applicants enter a whole number.',
  date: 'Applicants enter a day, month and year, which is checked as a real date.',
  email: 'Applicants enter an email address, which is checked for its format.',
  yes_no: 'Applicants choose Yes or No. Other questions can depend on the answer.',
  confirmation:
    'Applicants tick a box to confirm. The question above is the statement they confirm.',
};

function Settings({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-divider pt-4">
      <h3 className="text-body font-semibold text-ink">{heading}</h3>
      {children}
    </div>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d={path} />
    </svg>
  );
}

const MIN_COLUMNS = 2;

function BudgetTable({
  question,
  onChange,
}: {
  question: FormQuestion;
  onChange: (patch: Partial<FormQuestion>) => void;
}) {
  const focus = useRef<'add' | number | null>(null);
  const columnCount = question.columns.length;

  useEffect(() => {
    const target = focus.current;
    focus.current = null;
    if (target === null) return;
    document.getElementById(target === 'add' ? 'add-column' : `column-${String(target)}`)?.focus();
  }, [columnCount]);

  function changeColumn(index: number, patch: Partial<BudgetColumn>) {
    onChange({
      columns: question.columns.map((column, position) =>
        position === index ? { ...column, ...patch } : column,
      ),
    });
  }

  function addColumn() {
    focus.current = columnCount;
    onChange({ columns: [...question.columns, { heading: 'New column', kind: 'text' }] });
  }

  function removeColumn(index: number) {
    if (columnCount <= MIN_COLUMNS) return;
    focus.current = 'add';
    onChange({
      columns: question.columns.filter((_, position) => position !== index),
      sample: question.sample.map((row) => row.filter((_, position) => position !== index)),
    });
  }

  const rowsInvalid = question.minRows > question.maxRows;

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="text-body font-medium text-ink">Columns</p>
        <div aria-hidden="true" className="flex gap-2 text-sm font-medium text-muted">
          <span className="flex-1">Heading</span>
          <span className="w-28">Type</span>
          <span className="w-10" />
        </div>
        {question.columns.map((column, index) => (
          <div key={index} className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input
                id={`column-${String(index)}`}
                aria-label={`Heading of column ${String(index + 1)}`}
                value={column.heading}
                autoComplete="off"
                onChange={(event) => {
                  changeColumn(index, { heading: event.currentTarget.value });
                }}
              />
            </div>
            <div className="w-28 shrink-0">
              <Select
                aria-label={`Type of column ${String(index + 1)}`}
                value={column.kind}
                onChange={(event) => {
                  const kind = choose(columnKinds, event.currentTarget.value);
                  if (kind) changeColumn(index, { kind });
                }}
              >
                <option value="text">Text</option>
                <option value="currency">Currency</option>
              </Select>
            </div>
            <Button
              variant="quiet"
              aria-label={`Remove column ${String(index + 1)}: ${column.heading}`}
              aria-disabled={columnCount <= MIN_COLUMNS}
              onClick={() => {
                removeColumn(index);
              }}
            >
              <Icon path="M4 4l8 8M12 4l-8 8" />
            </Button>
          </div>
        ))}
        <Button
          id="add-column"
          variant="quiet"
          className="-ml-control-x self-start"
          onClick={addColumn}
        >
          <Icon path="M8 3.5v9M3.5 8h9" />
          Add a column
        </Button>
      </div>
      <FieldGroup
        legend="Number of rows"
        error={
          rowsInvalid
            ? 'Fewest rows cannot be more than most rows. Lower the fewest or raise the most.'
            : undefined
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Fewest rows">
            <Input
              value={String(question.minRows)}
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              className="tabular-nums"
              onChange={(event) => {
                onChange({ minRows: digits(event.currentTarget.value) });
              }}
            />
          </FormField>
          <FormField label="Most rows">
            <Input
              value={String(question.maxRows)}
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              className="tabular-nums"
              onChange={(event) => {
                onChange({ maxRows: digits(event.currentTarget.value) });
              }}
            />
          </FormField>
        </div>
      </FieldGroup>
      <CheckboxGroup
        legend="Total"
        name="show-total"
        values={question.showTotal ? ['total'] : []}
        onValuesChange={(values) => {
          onChange({ showTotal: values.includes('total') });
        }}
        options={[{ value: 'total', label: 'Show a total' }]}
        hint="Adds up the currency column under the table."
      />
    </>
  );
}

function FileUpload({
  question,
  onChange,
}: {
  question: FormQuestion;
  onChange: (patch: Partial<FormQuestion>) => void;
}) {
  return (
    <>
      <CheckboxGroup
        legend="Accepted file types"
        name="accepted-types"
        values={question.accept}
        onValuesChange={(accept) => {
          onChange({ accept });
        }}
        options={fileTypes.map((type) => ({ value: type, label: type }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Largest file">
          <Select
            value={String(question.maxSizeMb)}
            onChange={(event) => {
              onChange({ maxSizeMb: digits(event.currentTarget.value) });
            }}
          >
            {[5, 10, 20].map((size) => (
              <option key={size} value={size}>
                {size} MB
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Most files">
          <Input
            value={String(question.maxFiles)}
            inputMode="numeric"
            autoComplete="off"
            maxLength={1}
            className="tabular-nums"
            onChange={(event) => {
              onChange({ maxFiles: digits(event.currentTarget.value) });
            }}
          />
        </FormField>
      </div>
    </>
  );
}

function TypeSettings({
  question,
  onChange,
}: {
  question: FormQuestion;
  onChange: (patch: Partial<FormQuestion>) => void;
}) {
  const name = questionTypes.find((type) => type.value === question.type)?.label ?? '';
  const note = notes[question.type];

  switch (question.type) {
    case 'budget_table':
      return (
        <Settings heading={`${name} settings`}>
          <BudgetTable question={question} onChange={onChange} />
        </Settings>
      );
    case 'file_upload':
      return (
        <Settings heading={`${name} settings`}>
          <FileUpload question={question} onChange={onChange} />
        </Settings>
      );
    case 'long_text':
      return (
        <Settings heading={`${name} settings`}>
          <FormField label="Word limit">
            <Input
              value={String(question.wordLimit)}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              className="max-w-32 tabular-nums"
              onChange={(event) => {
                onChange({ wordLimit: digits(event.currentTarget.value) });
              }}
            />
          </FormField>
        </Settings>
      );
    case 'currency':
      return (
        <Settings heading={`${name} settings`}>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Smallest amount (£)">
              <Input
                value={String(question.minAmount)}
                inputMode="numeric"
                autoComplete="off"
                className="tabular-nums"
                onChange={(event) => {
                  onChange({ minAmount: digits(event.currentTarget.value) });
                }}
              />
            </FormField>
            <FormField label="Largest amount (£)">
              <Input
                value={String(question.maxAmount)}
                inputMode="numeric"
                autoComplete="off"
                className="tabular-nums"
                onChange={(event) => {
                  onChange({ maxAmount: digits(event.currentTarget.value) });
                }}
              />
            </FormField>
          </div>
          <p className="text-sm text-muted">Use 0 for no limit.</p>
        </Settings>
      );
    case 'choice':
      return (
        <Settings heading={`${name} settings`}>
          <FormField label="Options" hint="Write one option on each line.">
            <Textarea
              rows={6}
              value={question.options}
              onChange={(event) => {
                onChange({ options: event.currentTarget.value });
              }}
            />
          </FormField>
          <CheckboxGroup
            legend="Answers"
            name="allow-several"
            values={question.multiple ? ['several'] : []}
            onValuesChange={(values) => {
              onChange({ multiple: values.includes('several') });
            }}
            options={[{ value: 'several', label: 'Applicants can choose more than one' }]}
          />
        </Settings>
      );
    default:
      return note === undefined ? null : (
        <p className="border-t border-divider pt-4 text-body text-muted">{note}</p>
      );
  }
}

export interface QuestionEditorProps {
  question: FormQuestion;
  /** Where the question sits in its section, from 0, and how many questions the section has. */
  index: number;
  length: number;
  /** The section's title, for "Question 1 of 3 in Budget". */
  section: string;
  onChange: (patch: Partial<FormQuestion>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

/** The settings of the selected question: what every question has, then what its type adds. */
export function QuestionEditor({
  question,
  index,
  length,
  section,
  onChange,
  onMove,
  onRemove,
}: QuestionEditorProps) {
  const lastId = useId();
  return (
    <Panel title="Edit question">
      <p className="-mt-2 text-sm text-muted">
        Question {index + 1} of {length} in {section}
      </p>
      <FormField id="question-label" label="Question">
        <Input
          value={question.label}
          autoComplete="off"
          onChange={(event) => {
            onChange({ label: event.currentTarget.value });
          }}
        />
      </FormField>
      <FormField label="Hint" optional>
        <Textarea
          rows={3}
          value={question.hint}
          onChange={(event) => {
            onChange({ hint: event.currentTarget.value });
          }}
        />
      </FormField>
      <div className="grid grid-cols-1 gap-3 min-[24rem]:grid-cols-2">
        <FormField label="Type">
          <Select
            value={question.type}
            onChange={(event) => {
              const type = choose(questionTypes, event.currentTarget.value);
              if (type) onChange({ type });
            }}
          >
            {questionTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Required or optional">
          <Select
            value={question.required ? 'required' : 'optional'}
            onChange={(event) => {
              onChange({ required: event.currentTarget.value === 'required' });
            }}
          >
            <option value="required">Required</option>
            <option value="optional">Optional</option>
          </Select>
        </FormField>
      </div>
      <FormField label="Who can see the answer">
        <Select
          value={question.visibility}
          onChange={(event) => {
            const visibility = choose(visibilities, event.currentTarget.value);
            if (visibility) onChange({ visibility });
          }}
        >
          {visibilities.map((visibility) => (
            <option key={visibility.value} value={visibility.value}>
              {visibility.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Show this question">
        <Select
          value={question.condition}
          onChange={(event) => {
            const condition = choose(conditions, event.currentTarget.value);
            if (condition) onChange({ condition });
          }}
        >
          {conditions.map((condition) => (
            <option key={condition.value} value={condition.value}>
              {condition.label}
            </option>
          ))}
        </Select>
      </FormField>
      <TypeSettings question={question} onChange={onChange} />
      <div className="flex flex-col gap-2 border-t border-divider pt-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="quiet"
            aria-disabled={index === 0}
            onClick={() => {
              onMove(-1);
            }}
          >
            Move up<span className="sr-only"> {question.label}</span>
          </Button>
          <Button
            variant="quiet"
            aria-disabled={index === length - 1}
            onClick={() => {
              onMove(1);
            }}
          >
            Move down<span className="sr-only"> {question.label}</span>
          </Button>
        </div>
        <Button
          variant="quiet"
          className="self-start"
          aria-disabled={length === 1}
          aria-describedby={length === 1 ? lastId : undefined}
          onClick={onRemove}
        >
          Remove question<span className="sr-only"> {question.label}</span>
        </Button>
        {length === 1 && (
          <p id={lastId} className="text-sm text-muted">
            A section keeps at least one question. Add another before you remove this one.
          </p>
        )}
      </div>
    </Panel>
  );
}
