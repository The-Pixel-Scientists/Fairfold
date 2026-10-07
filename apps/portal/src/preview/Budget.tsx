// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of Section 3 of 6, the budget: two table questions the applicant can
// add to and remove from, the costs and any other funding, and the amount they
// ask for, worked out for them. The numbers stay in step as they type, and
// nothing is worked out while an amount is not a number.

import {
  Button,
  ErrorSummary,
  FileDrop,
  FormField,
  Input,
  SaveStatus,
  SectionProgress,
  Textarea,
  cx,
  useNavigate,
} from '@pixel-scientists/ui';
import type { ErrorSummaryItem, FileDropItem, SaveState } from '@pixel-scientists/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { PageColumn } from '../PageColumn.tsx';
import { fileRules, fundingEvidence, savedAt } from './journey.ts';
import { CrossIcon, PlusIcon, ScreenHeader, Section, TickIcon } from './parts.tsx';
import { budget, otherFunding, pounds, round } from './story.ts';

interface Cost {
  id: number;
  item: string;
  detail: string;
  amount: string;
}

interface Funding {
  id: number;
  source: string;
  amount: string;
}

const AMOUNT = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
const PENCE_PER_POUND = 100;
const REQUEST_ID = 'amount-requested';
const COST_ERROR = 'Enter the cost in pounds, like 2,880';
const FUNDING_ERROR = 'Enter the amount in pounds, like 1,000';
const range = `${pounds(round.minimumAward)} to ${pounds(round.maximumAward)}`;
const NOT_WORKED_OUT = 'We cannot work this out until every amount is a number.';

/** From a medium screen up the fields of a line sit side by side. Below that they stack. */
const costColumns = 'md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_9.5rem]';
const fundingColumns = 'md:grid-cols-[minmax(0,1fr)_9.5rem]';

/** What was typed, in pence, or null when it is not an amount. A blank box is nothing. */
function penceOf(text: string): number | null {
  const typed = text.replace('£', '').trim();
  if (typed === '') return 0;
  return AMOUNT.test(typed)
    ? Math.round(Number(typed.replaceAll(',', '')) * PENCE_PER_POUND)
    : null;
}

/** The amounts added up, in pence, or null while any of them is not a number. */
function totalOf(lines: readonly { amount: string }[]): number | null {
  let total = 0;
  for (const { amount } of lines) {
    const pence = penceOf(amount);
    if (pence === null) return null;
    total += pence;
  }
  return total;
}

/** Pounds, with pence only when there are some. */
function money(pence: number): string {
  if (pence % PENCE_PER_POUND === 0) return pounds(pence / PENCE_PER_POUND);
  return `£${(pence / PENCE_PER_POUND).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Figures {
  total: number;
  other: number;
  requested: number;
  inRange: boolean;
}

/** The amount asked for, or null while either total is not a number: no figure is better than a wrong one. */
function work(total: number | null, other: number | null): Figures | null {
  if (total === null || other === null) return null;
  const requested = Math.max(total - other, 0);
  return {
    total,
    other,
    requested,
    inRange:
      requested >= round.minimumAward * PENCE_PER_POUND &&
      requested <= round.maximumAward * PENCE_PER_POUND,
  };
}

/** What a screen reader is told about the amount asked for. */
function spoken(figures: Figures | null): string {
  if (figures === null) {
    return 'We cannot work out the amount you are asking for until every amount is a number.';
  }
  return `You are asking for ${money(figures.requested)}. This is ${figures.inRange ? 'within' : 'outside'} the range for this fund.`;
}

/** The ids of the fields and buttons that a link or focus has to find. */
const costItemId = (id: number) => `cost-${String(id)}-item`;
const costAmountId = (id: number) => `cost-${String(id)}-amount`;
const fundingSourceId = (id: number) => `funding-${String(id)}-source`;
const fundingAmountId = (id: number) => `funding-${String(id)}-amount`;
const ADD_COST_ID = 'add-cost';
const ADD_FUNDING_ID = 'add-funding';

/** Everything to fix before the person can carry on, for the summary at the top. */
function problemsOf(
  costs: readonly Cost[],
  funding: readonly Funding[],
  figures: Figures | null,
): ErrorSummaryItem[] {
  const problems: ErrorSummaryItem[] = [];
  costs.forEach((cost, index) => {
    if (penceOf(cost.amount) === null) {
      problems.push({
        fieldId: costAmountId(cost.id),
        message: `Enter the cost for line ${String(index + 1)} in pounds, like 2,880`,
      });
    }
  });
  funding.forEach((line, index) => {
    if (penceOf(line.amount) === null) {
      problems.push({
        fieldId: fundingAmountId(line.id),
        message: `Enter the amount for other funding ${String(index + 1)} in pounds, like 1,000`,
      });
    }
  });
  if (figures !== null && !figures.inRange) {
    problems.push({
      fieldId: REQUEST_ID,
      message: `The amount you ask for must be between ${pounds(round.minimumAward)} and ${pounds(round.maximumAward)}`,
    });
  }
  return problems;
}

const initialCosts: readonly Cost[] = budget.map((line, index) => ({
  id: index,
  item: line.item,
  detail: line.detail,
  amount: line.cost.toLocaleString('en-GB'),
}));
const initialFunding: readonly Funding[] = otherFunding.map((line, index) => ({
  id: index,
  source: line.source,
  amount: line.amount.toLocaleString('en-GB'),
}));

const initialEvidence: readonly FileDropItem[] = [
  { id: fundingEvidence.id, ...fundingEvidence.file, status: 'ready' },
];

interface FocusIds {
  /** The id of a line's first field. */
  first: (id: number) => string;
  /** The id of the button that adds a line. */
  add: string;
}

/** Lines the person can add, change and remove. After an add or a remove, focus goes where they are working. */
function useLines<T extends { id: number }>(
  initial: readonly T[],
  blank: (id: number) => T,
  onChange: () => void,
  focusIds: FocusIds,
) {
  const [lines, setLines] = useState(initial);
  const nextId = useRef(initial.length);
  const focusId = useRef<string | null>(null);

  useEffect(() => {
    if (focusId.current === null) return;
    document.getElementById(focusId.current)?.focus();
    focusId.current = null;
  }, [lines.length]);

  function change(next: readonly T[]) {
    setLines(next);
    onChange();
  }

  function edit(id: number, patch: Partial<T>) {
    change(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function add() {
    const line = blank(nextId.current++);
    focusId.current = focusIds.first(line.id);
    change([...lines, line]);
  }

  /** Returns the lines that are left. */
  function remove(index: number, id: number) {
    const next = lines.filter((line) => line.id !== id);
    const neighbour = next[Math.min(index, next.length - 1)];
    focusId.current = neighbour ? focusIds.first(neighbour.id) : focusIds.add;
    change(next);
    return next;
  }

  return { lines, edit, add, remove };
}

/** An amount in pounds, typed as text. The £ is beside the box, and spoken as its unit. */
function MoneyInput({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (text: string) => void;
  onBlur: () => void;
}) {
  const unitId = useId();
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="text-body text-ink">
        £
      </span>
      <Input
        value={value}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={unitId}
        className="min-w-0 text-end tabular-nums"
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        onBlur={onBlur}
      />
      <span id={unitId} className="sr-only">
        Amount in pounds
      </span>
    </div>
  );
}

interface AmountFieldProps {
  id: string;
  label: ReactNode;
  value: string;
  /** What to say when the box does not hold an amount. */
  error: string;
  onChange: (text: string) => void;
  onBlur: () => void;
}

/** A money box with its label, and its error kept below the box. */
function AmountField({ id, label, value, error, onChange, onBlur }: AmountFieldProps) {
  return (
    <FormField
      id={id}
      label={label}
      error={penceOf(value) === null ? error : undefined}
      className="[&>[id$=-error]]:order-last"
    >
      <MoneyInput value={value} onChange={onChange} onBlur={onBlur} />
    </FormField>
  );
}

/** Shows its words on a phone, where each field stands alone, and only speaks them where a column heading shows them. */
function rowLabel(label: string, line: string) {
  return (
    <span className="md:sr-only">
      {label} <span className="sr-only">for {line}</span>
    </span>
  );
}

/** The column headings from a medium screen up. A phone shows each field's own label instead. */
function Headings({ columns, labels }: { columns: string; labels: readonly string[] }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'hidden gap-x-3 border-b border-divider pb-2 text-sm font-medium text-muted md:grid',
        columns,
      )}
    >
      {labels.map((label, index) => (
        <span key={label} className={index === labels.length - 1 ? 'text-end' : undefined}>
          {label}
        </span>
      ))}
    </div>
  );
}

interface LineRowProps {
  /** What the line is called, such as "line 3". It names the group for a screen reader. */
  name: string;
  columns: string;
  onRemove: () => void;
  children: ReactNode;
}

/** One line of a table question: its fields, then a way to remove it. */
function LineRow({ name, columns, onRemove, children }: LineRowProps) {
  const titleId = useId();
  return (
    <li className="border-t border-divider py-5 first:border-t-0 first:pt-0 md:py-3 md:first:pt-3">
      <div
        role="group"
        aria-labelledby={titleId}
        className={cx('grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-4 md:gap-y-1', columns)}
      >
        <p
          id={titleId}
          className="col-span-full text-sm font-medium text-muted first-letter:uppercase md:sr-only"
        >
          {name}
        </p>
        {children}
        <Button
          variant="quiet"
          className="-mr-3.5 self-end justify-self-end md:col-end-[-1] md:min-h-8 md:self-start"
          onClick={onRemove}
        >
          Remove <span className="sr-only">{name}</span>
        </Button>
      </div>
    </li>
  );
}

interface RowProps<T> {
  line: T;
  number: number;
  onEdit: (patch: Partial<T>) => void;
  onRemove: () => void;
  onAmountBlur: () => void;
}

/** One cost: what it is, how it was worked out and how much. */
function CostRow({ line, number, onEdit, onRemove, onAmountBlur }: RowProps<Cost>) {
  const name = `line ${String(number)}`;
  return (
    <LineRow name={name} columns={costColumns} onRemove={onRemove}>
      <FormField
        id={costItemId(line.id)}
        label={rowLabel('Item', name)}
        className="col-span-full md:col-span-1"
      >
        <Input
          value={line.item}
          autoComplete="off"
          onChange={(event) => {
            onEdit({ item: event.currentTarget.value });
          }}
        />
      </FormField>
      <FormField
        label={rowLabel('Detail', name)}
        className="col-span-full md:col-span-1 md:row-span-2"
      >
        <Textarea
          rows={2}
          value={line.detail}
          className="resize-y md:flex-1 md:resize-none"
          onChange={(event) => {
            onEdit({ detail: event.currentTarget.value });
          }}
        />
      </FormField>
      <AmountField
        id={costAmountId(line.id)}
        label={rowLabel('Cost', name)}
        value={line.amount}
        error={COST_ERROR}
        onChange={(text) => {
          onEdit({ amount: text });
        }}
        onBlur={onAmountBlur}
      />
    </LineRow>
  );
}

/** One source of other funding, and how much it gives. */
function FundingRow({ line, number, onEdit, onRemove, onAmountBlur }: RowProps<Funding>) {
  const name = `other funding ${String(number)}`;
  return (
    <LineRow name={name} columns={fundingColumns} onRemove={onRemove}>
      <FormField
        id={fundingSourceId(line.id)}
        label={rowLabel('Where the money comes from', name)}
        className="col-span-full md:col-span-1"
      >
        <Input
          value={line.source}
          autoComplete="off"
          onChange={(event) => {
            onEdit({ source: event.currentTarget.value });
          }}
        />
      </FormField>
      <AmountField
        id={fundingAmountId(line.id)}
        label={rowLabel('Amount', name)}
        value={line.amount}
        error={FUNDING_ERROR}
        onChange={(text) => {
          onEdit({ amount: text });
        }}
        onBlur={onAmountBlur}
      />
    </LineRow>
  );
}

/** A table's total, or why there is none yet. */
function Total({ label, pence }: { label: string; pence: number | null }) {
  return (
    <p className="flex items-baseline justify-between gap-4 border-t border-edge/40 pt-4 text-lg font-semibold text-ink">
      <span>{label}</span>
      <span className={cx('tabular-nums', pence === null && 'font-medium text-muted')}>
        {pence === null ? 'Not worked out yet' : money(pence)}
      </span>
    </p>
  );
}

export default function Budget() {
  const navigate = useNavigate();
  const [saved, setSaved] = useState<SaveState>({ status: 'saved', at: savedAt });
  const saveNow = () => {
    setSaved({ status: 'saved', at: savedAt });
  };
  const costs = useLines<Cost>(
    initialCosts,
    (id) => ({ id, item: '', detail: '', amount: '' }),
    saveNow,
    { first: costItemId, add: ADD_COST_ID },
  );
  const funding = useLines<Funding>(
    initialFunding,
    (id) => ({ id, source: '', amount: '' }),
    saveNow,
    { first: fundingSourceId, add: ADD_FUNDING_ID },
  );
  const [evidence, setEvidence] = useState(initialEvidence);
  const [attempts, setAttempts] = useState(0);
  const [announced, setAnnounced] = useState(() =>
    spoken(work(totalOf(initialCosts), totalOf(initialFunding))),
  );

  const total = totalOf(costs.lines);
  const other = totalOf(funding.lines);
  const figures = work(total, other);
  const problems = problemsOf(costs.lines, funding.lines, figures);
  // A screen reader hears the new amount when a box is left, not on every key.
  const announce = () => {
    setAnnounced(spoken(figures));
  };

  return (
    <PageColumn>
      {attempts > 0 && problems.length > 0 && <ErrorSummary key={attempts} errors={problems} />}
      <ScreenHeader
        title="Budget"
        eyebrow={`${round.programme}, ${round.name}`}
        breadcrumbs={[{ label: 'Your application', to: '/application' }, { label: 'Budget' }]}
        progress={<SectionProgress current={3} total={6} />}
      >
        <p>
          Tell us what the project will cost. Then tell us about any other money, and we will work
          out what you are asking us for.
        </p>
      </ScreenHeader>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // The preview skips Section 4, Outcomes, which it does not draw.
          if (problems.length > 0) setAttempts((count) => count + 1);
          else navigate('/application/documents');
        }}
        className="flex flex-col gap-10"
      >
        <Section title="Costs of the project">
          <p className="max-w-prose text-body text-muted">
            Add a line for each cost. Say what it is, and how you worked out the amount. For
            example: “48 Tuesdays at £60”.
          </p>
          {costs.lines.length > 0 ? (
            <div>
              <Headings columns={costColumns} labels={['Item', 'Detail', 'Cost']} />
              <ul role="list" aria-label="Costs" className="flex flex-col">
                {costs.lines.map((line, index) => (
                  <CostRow
                    key={line.id}
                    line={line}
                    number={index + 1}
                    onEdit={(patch) => {
                      costs.edit(line.id, patch);
                    }}
                    onRemove={() => {
                      setAnnounced(spoken(work(totalOf(costs.remove(index, line.id)), other)));
                    }}
                    onAmountBlur={announce}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-body text-muted">No costs yet. Add the first one below.</p>
          )}
          <div>
            <Button id={ADD_COST_ID} onClick={costs.add}>
              <PlusIcon />
              Add a cost
            </Button>
          </div>
          <Total label="Total cost of the project" pence={total} />
        </Section>

        <Section title="Other funding">
          <p className="max-w-prose text-body text-muted">
            Is any other money going into this project? Tell us who is giving it and how much. We
            take it off what you ask us for.
          </p>
          {funding.lines.length > 0 ? (
            <div>
              <Headings
                columns={fundingColumns}
                labels={['Where the money comes from', 'Amount']}
              />
              <ul role="list" aria-label="Other funding" className="flex flex-col">
                {funding.lines.map((line, index) => (
                  <FundingRow
                    key={line.id}
                    line={line}
                    number={index + 1}
                    onEdit={(patch) => {
                      funding.edit(line.id, patch);
                    }}
                    onRemove={() => {
                      setAnnounced(spoken(work(total, totalOf(funding.remove(index, line.id)))));
                    }}
                    onAmountBlur={announce}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-body text-muted">
              No other funding yet. Add it below if there is any.
            </p>
          )}
          <div>
            <Button id={ADD_FUNDING_ID} onClick={funding.add}>
              <PlusIcon />
              Add other funding
            </Button>
          </div>
          <Total label="Total other funding" pence={other} />
          <FileDrop
            label={`${fundingEvidence.label} (optional)`}
            hint={`${fundingEvidence.hint} ${fileRules}`}
            accept=".pdf,.doc,.docx"
            files={evidence}
            onFilesChosen={([chosen]) => {
              if (chosen === undefined) return;
              setEvidence([
                {
                  id: crypto.randomUUID(),
                  name: chosen.name,
                  size: chosen.size,
                  status: 'scanning',
                },
              ]);
              saveNow();
            }}
            onRemove={() => {
              setEvidence([]);
              saveNow();
            }}
          />
        </Section>

        <Section
          id={REQUEST_ID}
          title="Amount you are asking for"
          className="rounded-lg border border-divider bg-surface p-gutter"
        >
          <p role="status" className="sr-only">
            {announced}
          </p>
          {figures === null ? (
            <p className="max-w-prose text-body text-ink">
              {NOT_WORKED_OUT} Check the amounts that have an error message.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-4xl font-semibold tracking-tight text-ink tabular-nums">
                {money(figures.requested)}
              </p>
              <p className="max-w-prose text-body text-muted">
                We work this out for you. It is the total cost of {money(figures.total)}, less{' '}
                {money(figures.other)} from other funding.
              </p>
              <p
                className={cx(
                  'flex items-start gap-2 text-body',
                  figures.inRange ? 'text-success' : 'font-medium text-danger',
                )}
              >
                <span className="mt-1 shrink-0">
                  {figures.inRange ? <TickIcon /> : <CrossIcon />}
                </span>
                {figures.inRange
                  ? `This is within the range for this fund: ${range}.`
                  : `This fund gives ${range}. Change your costs or other funding so that the amount you ask for is in that range.`}
              </p>
            </div>
          )}
        </Section>

        <div className="flex flex-col gap-5 border-t border-divider pt-6">
          <div className="flex flex-col gap-1">
            <SaveStatus state={saved} />
            <p className="text-sm text-muted">
              We save your answers as you type. You can leave at any time.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" variant="primary" className="w-full sm:w-auto">
              Save and continue
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                navigate('/application');
              }}
            >
              Save and come back later
            </Button>
          </div>
        </div>
      </form>
    </PageColumn>
  );
}
