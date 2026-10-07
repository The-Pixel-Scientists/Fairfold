// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  CheckboxGroup,
  FileDrop,
  FormField,
  Input,
  Panel,
  RadioGroup,
  Textarea,
  cx,
} from '@pixel-scientists/ui';
import type { FileDropItem } from '@pixel-scientists/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

import { pounds } from '../story.ts';

import { budgetTotal, sampleTotals, workedOutAmount } from './formData.ts';
import type { BudgetColumn, FormQuestion, Totals } from './formData.ts';

/** What has been entered, by question id: text, or the options ticked on a multiple choice. */
export type Answers = Readonly<Record<string, string | readonly string[]>>;

const noAnswers: Answers = {};

type Rows = readonly (readonly string[])[];

/** The question with “(optional)” after it in the muted, normal weight a FormField uses. */
const legendOf = (question: FormQuestion): ReactNode =>
  question.required ? (
    question.label
  ) : (
    <>
      {question.label} <span className="font-normal text-muted">(optional)</span>
    </>
  );

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

function wordsLeft(text: string, limit: number): string {
  const left = limit - wordCount(text);
  const words = Math.abs(left) === 1 ? 'word' : 'words';
  return `You have ${String(Math.abs(left))} ${words} ${left < 0 ? 'too many' : 'left'}`;
}

/** A screen reader hears a change once typing stops, not at every key. */
const ANNOUNCE_AFTER_MS = 1000;

function useAfterTyping(message: string): string {
  const [announced, setAnnounced] = useState(message);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnnounced(message);
    }, ANNOUNCE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [message]);
  return announced;
}

const box =
  'block min-h-control rounded-md border border-edge bg-surface px-control-x py-1.5 text-body text-ink';

/**
 * The budget as a table with a heading row. Below sm each row stacks, with
 * every cell labelled by its heading, as the portal shows it on a phone. The
 * rows are the question's example rows until someone changes them. Live, the
 * cells are fields, which wrap what is typed in them, and rows can be added
 * and removed; otherwise the table is a picture of them, with each example in
 * full. Whatever the rows add up to is passed to `onTotal` as it changes.
 */
function BudgetTable({
  question,
  live,
  onTotal,
}: {
  question: FormQuestion;
  live: boolean;
  onTotal: (total: number) => void;
}) {
  const [typed, setTyped] = useState<Rows | null>(null);
  const rows = typed ?? question.sample;
  const base = useId();
  const cellId = (row: number, column: number) => `${base}-${String(row)}-${String(column)}`;
  const addId = `${base}-add`;
  const labelId = `${base}-label`;
  const hintId = `${base}-hint`;
  const focusAfter = useRef<string | null>(null);
  const [change, setChange] = useState('');

  useEffect(() => {
    if (focusAfter.current === null) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [rows]);

  const costColumn = question.columns.findIndex((column) => column.kind === 'currency');
  const total = budgetTotal(question, rows);
  const full = rows.length >= question.maxRows;
  const atLeast = rows.length <= question.minRows;
  const amount = pounds(total);
  const showTotal = question.showTotal && costColumn >= 0;
  const announced = useAfterTyping(
    `${change}${showTotal ? `${question.totalLabel} is ${amount}` : ''}`.trim(),
  );
  const textColumns = question.columns.filter((column) => column.kind === 'text').length;

  const commit = (next: Rows) => {
    setTyped(next);
    onTotal(budgetTotal(question, next));
  };
  const edit = (rowIndex: number, columnIndex: number, value: string) => {
    setChange('');
    commit(
      rows.map((row, index) =>
        index === rowIndex
          ? question.columns.map((_, column) =>
              column === columnIndex ? value : (row[column] ?? ''),
            )
          : row,
      ),
    );
  };
  const add = () => {
    if (full) return;
    focusAfter.current = cellId(rows.length, 0);
    setChange(`Row ${String(rows.length + 1)} added. `);
    commit([...rows, question.columns.map(() => '')]);
  };
  const remove = (rowIndex: number) => {
    if (atLeast) return;
    focusAfter.current = addId;
    setChange(`Row ${String(rowIndex + 1)} removed. `);
    commit(rows.filter((_, index) => index !== rowIndex));
  };

  const cell = (row: readonly string[], rowIndex: number, column: BudgetColumn, index: number) => {
    if (!live) {
      return (
        <span className={cx(box, column.kind === 'currency' && 'text-end tabular-nums')}>
          {row[index]}
        </span>
      );
    }
    const field = {
      id: cellId(rowIndex, index),
      'aria-label': `${column.heading}, row ${String(rowIndex + 1)}`,
      value: row[index] ?? '',
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        edit(rowIndex, index, event.currentTarget.value);
      },
    };
    if (column.kind === 'currency') {
      return <Input className="text-end tabular-nums" {...field} />;
    }
    // Text wraps and the box grows to fit it, so all of it shows at any width or zoom. A name such
    // as an item starts on one line and text that explains on two. Where a browser cannot size the
    // box to its text it keeps those lines, and the handle lets someone make it taller.
    return (
      <Textarea
        rows={index > 0 || textColumns === 1 ? 2 : 1}
        className="resize-y field-sizing-content"
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
        {...field}
      />
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-body font-medium text-ink">
        {question.label}
        {!question.required && <span className="font-normal text-muted"> (optional)</span>}
      </p>
      {question.hint !== '' && (
        <p id={hintId} className="text-body text-muted">
          {question.hint}
        </p>
      )}
      {live && (
        <p role="status" className="sr-only">
          {announced}
        </p>
      )}
      <table
        aria-labelledby={labelId}
        aria-describedby={question.hint === '' ? undefined : hintId}
        className="w-full border-collapse text-body max-sm:block"
      >
        <thead className="max-sm:sr-only">
          <tr>
            {question.columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={cx(
                  'px-1 pb-1 text-sm font-medium text-muted',
                  column.kind === 'currency' ? 'text-end' : 'text-start',
                )}
              >
                {column.heading}
              </th>
            ))}
            {live && (
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="max-sm:flex max-sm:flex-col max-sm:gap-2 max-sm:border-t max-sm:border-divider max-sm:py-3 max-sm:first:border-t-0 max-sm:first:pt-0"
            >
              {question.columns.map((column, index) => (
                <td
                  key={index}
                  data-label={column.heading}
                  className={cx(
                    'px-1 py-1 align-top',
                    'max-sm:flex max-sm:flex-col max-sm:gap-1 max-sm:p-0 max-sm:before:text-sm max-sm:before:font-medium max-sm:before:text-muted max-sm:before:content-[attr(data-label)]',
                    column.kind === 'currency' && 'w-36',
                  )}
                >
                  {cell(row, rowIndex, column, index)}
                </td>
              ))}
              {live && (
                <td className="px-1 py-1 align-top max-sm:p-0">
                  <Button
                    variant="quiet"
                    aria-disabled={atLeast}
                    onClick={() => {
                      remove(rowIndex);
                    }}
                  >
                    Remove
                    <span className="sr-only">
                      {' '}
                      row {rowIndex + 1}, {question.label}
                    </span>
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {showTotal && (
          <tfoot className="max-sm:block">
            <tr className="max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:border-t max-sm:border-divider max-sm:pt-3">
              <th
                scope="row"
                colSpan={Math.max(costColumn, 1)}
                className="px-1 pt-2 text-end text-body font-medium text-ink max-sm:p-0"
              >
                {question.totalLabel}
              </th>
              <td className="px-1 pt-2 text-end font-semibold text-ink tabular-nums max-sm:p-0">
                {amount}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      <Button id={addId} className="self-start" aria-disabled={full} onClick={add}>
        {question.addLabel}
      </Button>
    </div>
  );
}

/** The words left in an answer, tied to the box it counts and spoken once typing stops. */
function WordCount({ id, text, limit }: { id: string; text: string; limit: number }) {
  const count = wordsLeft(text, limit);
  const announced = useAfterTyping(count);
  return (
    <>
      <p id={id} className="text-body text-muted">
        {count}
      </p>
      <p role="status" className="sr-only">
        {announced}
      </p>
    </>
  );
}

/** An amount the form works out, shown as text with its label and hint. A screen reader hears a change once typing stops. */
function WorkedOutAmount({ question, amount }: { question: FormQuestion; amount: number }) {
  const labelId = useId();
  const hintId = useId();
  const text = pounds(amount);
  const announced = useAfterTyping(`${question.label} is ${text}`);
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={question.hint === '' ? undefined : hintId}
      className="flex flex-col gap-field-gap"
    >
      <p id={labelId} className="text-body font-medium text-ink">
        {question.label}
      </p>
      {question.hint !== '' && (
        <p id={hintId} className="text-body text-muted">
          {question.hint}
        </p>
      )}
      <p className="text-2xl font-semibold text-ink tabular-nums">{text}</p>
      <p role="status" className="sr-only">
        {announced}
      </p>
    </div>
  );
}

/** Files chosen are listed as ready and go nowhere. */
function Upload({ question }: { question: FormQuestion }) {
  const [files, setFiles] = useState<readonly FileDropItem[]>([]);
  const multiple = question.maxFiles > 1;
  return (
    <FileDrop
      label={question.required ? question.label : `${question.label} (optional)`}
      hint={[
        question.hint,
        `${question.accept.join(' or ')}, up to ${String(question.maxSizeMb)} MB.`,
      ]
        .filter(Boolean)
        .join(' ')}
      multiple={multiple}
      files={files}
      onFilesChosen={(chosen) => {
        const added = chosen.map((file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          status: 'ready' as const,
        }));
        setFiles([...(multiple ? files : []), ...added].slice(0, question.maxFiles));
      }}
      onRemove={(id) => {
        setFiles(files.filter((file) => file.id !== id));
      }}
    />
  );
}

interface ControlProps {
  question: FormQuestion;
  answers?: Answers;
  onAnswer?: (id: string, answer: string | readonly string[]) => void;
  /** What each budget table adds up to, which a worked-out amount is made from. The example rows' totals when left out. */
  totals?: Totals;
  /** Called with a budget table's id and its new total when its rows change. */
  onTotal?: (id: string, total: number) => void;
}

/**
 * One question as an applicant sees it. Hand it the answers so far and a way
 * to record them, and it works; leave them out and it is a picture.
 */
export function QuestionControl({
  question,
  answers = noAnswers,
  onAnswer,
  totals = sampleTotals,
  onTotal,
}: ControlProps) {
  const countId = useId();
  const answer = answers[question.id];
  const text = typeof answer === 'string' ? answer : '';
  const ticked = answer === undefined || typeof answer === 'string' ? [] : answer;
  const answerWith = (value: string | readonly string[]) => {
    onAnswer?.(question.id, value);
  };
  const typing = {
    value: text,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      answerWith(event.currentTarget.value);
    },
  };

  const field = {
    label: question.label,
    hint: question.hint === '' ? undefined : question.hint,
    optional: !question.required,
  };
  const options = question.options
    .split('\n')
    .filter(Boolean)
    .map((option) => ({ value: option, label: option }));

  switch (question.type) {
    case 'long_text':
      return (
        <FormField {...field}>
          <Textarea rows={4} aria-describedby={countId} {...typing} />
          <WordCount id={countId} text={text} limit={question.wordLimit} />
        </FormField>
      );
    case 'currency':
      if (question.workedOut) {
        return (
          <WorkedOutAmount
            question={question}
            amount={workedOutAmount(question.workedOut, totals)}
          />
        );
      }
      return (
        <FormField {...field}>
          <div className="flex items-center gap-2">
            <span aria-hidden="true">£</span>
            <Input className="max-w-48" {...typing} />
          </div>
        </FormField>
      );
    case 'yes_no':
      return (
        <RadioGroup
          legend={legendOf(question)}
          hint={field.hint}
          name={question.id}
          value={text}
          onValueChange={answerWith}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
        />
      );
    case 'choice':
      return question.multiple ? (
        <CheckboxGroup
          legend={legendOf(question)}
          hint={field.hint}
          name={question.id}
          values={ticked}
          onValuesChange={answerWith}
          options={options}
        />
      ) : (
        <RadioGroup
          legend={legendOf(question)}
          hint={field.hint}
          name={question.id}
          value={text}
          onValueChange={answerWith}
          options={options}
        />
      );
    case 'budget_table':
      return (
        <BudgetTable
          question={question}
          live={onAnswer !== undefined}
          onTotal={(total) => {
            onTotal?.(question.id, total);
          }}
        />
      );
    case 'file_upload':
      return <Upload question={question} />;
    case 'confirmation':
      return (
        <CheckboxGroup
          legend="Declaration"
          name={question.id}
          values={ticked}
          onValuesChange={answerWith}
          options={[{ value: 'agree', label: question.label }]}
        />
      );
    case 'date':
      return (
        <FormField {...field}>
          <Input placeholder="Day, month and year" className="max-w-48" {...typing} />
        </FormField>
      );
    case 'email':
      return (
        <FormField {...field}>
          <Input type="email" autoComplete="email" {...typing} />
        </FormField>
      );
    case 'number':
      return (
        <FormField {...field}>
          <Input inputMode="numeric" className="max-w-48" {...typing} />
        </FormField>
      );
    case 'short_text':
      return (
        <FormField {...field}>
          <Input {...typing} />
        </FormField>
      );
  }
}

/** The selected question as an applicant sees it. It is for looking at: nothing in it takes focus. */
export function QuestionPreview({ question }: { question: FormQuestion }) {
  return (
    <Panel title="How applicants see it">
      <p className="-mt-2 text-sm text-muted">
        A picture of this question as applicants see it. Use Preview form to try the whole form.
      </p>
      <div inert aria-hidden="true" className="max-w-xl">
        <QuestionControl question={question} />
      </div>
    </Panel>
  );
}
