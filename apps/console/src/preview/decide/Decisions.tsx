// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: Decisions. Rank, recommend an amount and record an outcome
// for every eligible application. Nothing reaches applicants until release.

import {
  Button,
  DataTable,
  Input,
  Link,
  Meter,
  PageHeader,
  Stats,
  Tag,
  buttonClassName,
  cx,
} from '@pixel-scientists/ui';
import type { Column, SortState } from '@pixel-scientists/ui';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';

import { pounds } from '../story.ts';
import {
  budget,
  candidates,
  maximumAward,
  minimumAward,
  outcomes,
  total,
} from './decisions-data.ts';
import type { Candidate, Outcome } from './decisions-data.ts';
import { OutcomeChoice } from './OutcomeChoice.tsx';
import { Eyebrow, Notice } from './parts.tsx';

interface Row extends Candidate {
  /** False once the person changes the row, until they record the change. */
  recorded: boolean;
}

type Filter = Outcome | 'All';

function problemFor({ outcome, amount, requested }: Row): string | undefined {
  if (outcome !== 'Accept') return undefined;
  if (amount > requested) return `Enter ${pounds(requested)} or less, the amount requested.`;
  if (amount > maximumAward)
    return `Enter ${pounds(maximumAward)} or less, the most this round awards.`;
  if (amount < minimumAward)
    return `Enter ${pounds(minimumAward)} or more, the least this round awards.`;
  return undefined;
}

function sortRows(rows: readonly Row[], { key, direction }: SortState): Row[] {
  const value = (row: Row) =>
    key === 'requested' ? row.requested : key === 'score' ? row.score : row.rank;
  const sign = direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => sign * (value(a) - value(b)));
}

function FilterChips({
  value,
  counts,
  onChange,
}: {
  value: Filter;
  counts: Record<Filter, number>;
  onChange: (filter: Filter) => void;
}) {
  const options: readonly Filter[] = ['All', ...outcomes];
  return (
    <div role="group" aria-label="Show decisions" className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const pressed = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            onClick={() => {
              onChange(option);
            }}
            className={cx(
              'inline-flex min-h-target items-center gap-1.5 rounded-full border px-3 text-sm',
              'transition-colors duration-(--motion-fast) ease-standard',
              pressed
                ? 'border-transparent bg-accent font-semibold text-on-accent'
                : 'border-edge text-ink hover:border-ink hover:bg-sunken',
            )}
          >
            {option}
            <span className={cx('tabular-nums', !pressed && 'text-muted')}>{counts[option]}</span>
          </button>
        );
      })}
    </div>
  );
}

function AmountInput({
  row,
  problem,
  onChange,
}: {
  row: Row;
  problem: string | undefined;
  onChange: (amount: number) => void;
}) {
  const problemId = useId();
  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="relative w-28">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted"
        >
          £
        </span>
        <Input
          aria-label={`Recommended amount for ${row.project}`}
          aria-describedby={problem === undefined ? undefined : problemId}
          aria-invalid={problem === undefined ? undefined : true}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={row.amount === 0 ? '' : row.amount.toLocaleString('en-GB')}
          onChange={(event) => {
            onChange(Number(event.currentTarget.value.replace(/\D/g, '')));
          }}
          className="scroll-mb-16 ps-6 text-end tabular-nums"
        />
      </div>
      {problem !== undefined && (
        <p id={problemId} className="text-xs font-medium text-danger">
          <span className="sr-only">Error: </span>
          {problem}
        </p>
      )}
      {problem === undefined && row.amount < row.requested && (
        <p className="text-xs whitespace-nowrap text-muted">
          {pounds(row.requested - row.amount)} less than asked
        </p>
      )}
    </div>
  );
}

export default function Decisions() {
  const [rows, setRows] = useState<readonly Row[]>(() =>
    candidates.map((candidate) => ({ ...candidate, recorded: true })),
  );
  const [sort, setSort] = useState<SortState>({ key: 'rank', direction: 'ascending' });
  const [filter, setFilter] = useState<Filter>('All');
  const blockedId = useId();
  const releaseId = useId();

  function update(reference: string, change: Partial<Pick<Row, 'outcome' | 'amount'>>) {
    setRows((current) =>
      current.map((row) =>
        row.reference === reference ? { ...row, ...change, recorded: false } : row,
      ),
    );
  }

  const withOutcome = (outcome: Outcome) => rows.filter((row) => row.outcome === outcome);
  const accepted = withOutcome('Accept');
  const committed = total(accepted.map((row) => row.amount));
  const unrecorded = rows.filter((row) => !row.recorded).length;
  const invalid = rows.filter((row) => problemFor(row) !== undefined).length;
  const over = committed - budget;

  const blockers = [
    unrecorded > 0 &&
      `${String(unrecorded)} ${unrecorded === 1 ? 'decision is' : 'decisions are'} not recorded.`,
    invalid > 0 &&
      `${String(invalid)} recommended ${invalid === 1 ? 'amount needs' : 'amounts need'} changing.`,
    over > 0 && `The recommended total is ${pounds(over)} over the ${pounds(budget)} budget.`,
  ].filter((text): text is string => text !== false);

  const record = (
    <Button
      aria-disabled={invalid > 0 ? 'true' : undefined}
      onClick={() => {
        if (invalid > 0) return;
        // This button goes once everything is recorded, so move focus to the next step.
        flushSync(() => {
          setRows((current) => current.map((row) => ({ ...row, recorded: true })));
        });
        document.getElementById(releaseId)?.focus();
      }}
    >
      Record {unrecorded === 1 ? 'the change' : `${String(unrecorded)} changes`}
    </Button>
  );

  const counts: Record<Filter, number> = {
    All: rows.length,
    Accept: accepted.length,
    Waitlist: withOutcome('Waitlist').length,
    Decline: withOutcome('Decline').length,
  };
  const shown = sortRows(
    filter === 'All' ? rows : rows.filter((row) => row.outcome === filter),
    sort,
  );

  const columns: readonly Column<Row>[] = [
    {
      key: 'rank',
      header: 'Rank',
      align: 'end',
      sortable: true,
      cell: (row) => <span className="text-muted">{row.rank}</span>,
    },
    {
      key: 'application',
      header: 'Application',
      rowHeader: true,
      cell: (row) => (
        <div className="flex max-w-64 flex-col whitespace-normal">
          <span>{row.project}</span>
          <span className="text-xs font-normal text-muted">
            {row.organisation} ·{' '}
            <span className="whitespace-nowrap tabular-nums">{row.reference}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'score',
      header: 'Mean score',
      align: 'end',
      sortable: true,
      cell: (row) => row.score.toFixed(2),
    },
    {
      key: 'requested',
      header: 'Requested',
      align: 'end',
      sortable: true,
      cell: (row) => pounds(row.requested),
    },
    {
      key: 'amount',
      header: 'Recommended',
      align: 'end',
      cell: (row) =>
        row.outcome === 'Accept' ? (
          <AmountInput
            row={row}
            problem={problemFor(row)}
            onChange={(amount) => {
              update(row.reference, { amount });
            }}
          />
        ) : (
          <>
            <span aria-hidden="true" className="text-muted">
              –
            </span>
            <span className="sr-only">No amount</span>
          </>
        ),
    },
    {
      key: 'outcome',
      header: 'Decision',
      cell: (row) => (
        <OutcomeChoice
          name={`decision-${row.reference}`}
          subject={row.project}
          value={row.outcome}
          onChange={(outcome) => {
            update(row.reference, { outcome });
          }}
        />
      ),
    },
    {
      key: 'state',
      header: 'State',
      cell: (row) =>
        row.recorded ? <Tag tone="info">Recorded (private)</Tag> : <Tag>Not recorded</Tag>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Programmes', to: '/programmes' },
          { label: 'Community Grants', to: '/programmes/community-grants' },
          { label: 'Spring 2027', to: '/programmes/community-grants/spring-2027' },
          { label: 'Decisions' },
        ]}
        eyebrow={
          <Eyebrow>
            <Tag tone="info">Deciding</Tag>
            <span>Community Grants, Spring 2027</span>
          </Eyebrow>
        }
        title="Decisions"
        description={`Recommend an outcome and an amount for each of the ${String(rows.length)} eligible applications, ranked by the panel's mean score.`}
        actions={
          blockers.length > 0 ? (
            <Button
              id={releaseId}
              variant="primary"
              aria-disabled="true"
              aria-describedby={blockedId}
            >
              Release decisions
            </Button>
          ) : (
            <Link id={releaseId} to="/decisions/release" className={buttonClassName('primary')}>
              Release decisions
            </Link>
          )
        }
      />

      <Notice icon="lock" tone="info" title="Applicants see nothing until you release decisions">
        Recording a decision keeps it private to staff. Releasing tells every applicant their
        outcome in one step, after you confirm it is you.
      </Notice>

      {blockers.length > 0 && (
        <Notice
          id={blockedId}
          icon="alert"
          tone="warning"
          title="You cannot release decisions yet"
          action={unrecorded > 0 && record}
        >
          <ul className="list-disc pl-4">
            {blockers.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Notice>
      )}

      <p role="status" className="sr-only">
        {unrecorded === 0
          ? `All ${String(rows.length)} decisions are recorded.`
          : `${String(unrecorded)} ${unrecorded === 1 ? 'decision is' : 'decisions are'} not recorded.`}
      </p>

      <div className="flex flex-col gap-4">
        <Stats
          label="Decision summary"
          items={[
            {
              label: 'Recommended',
              value: pounds(committed),
              detail: `to ${String(accepted.length)} applications`,
            },
            {
              label: 'Waitlisted',
              value: counts.Waitlist,
              detail: `asking for ${pounds(total(withOutcome('Waitlist').map((row) => row.requested)))}`,
            },
            {
              label: 'Declined',
              value: counts.Decline,
              detail: `asking for ${pounds(total(withOutcome('Decline').map((row) => row.requested)))}`,
            },
            {
              label: 'Recorded',
              value: `${String(rows.length - unrecorded)} of ${String(rows.length)}`,
              detail: 'private until released',
            },
          ]}
        />
        <Meter
          label="Recommended against budget"
          value={committed}
          max={budget}
          tone={over > 0 ? 'danger' : 'accent'}
          valueText={
            over > 0
              ? `${pounds(committed)} of ${pounds(budget)}, ${pounds(over)} over`
              : `${pounds(committed)} of ${pounds(budget)}, ${pounds(-over)} held back`
          }
        />
        {over < 0 && (
          <p className="text-sm text-muted">
            {pounds(-over)} is held back. It is offered to waitlisted applications in rank order
            once the {accepted.length} awards are accepted.
          </p>
        )}
      </div>

      <section aria-labelledby="ranking" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="ranking" className="text-lg font-semibold tracking-tight text-ink">
            Ranking
          </h2>
          <FilterChips value={filter} counts={counts} onChange={setFilter} />
        </div>
        <DataTable
          caption="Eligible applications in Spring 2027, ranked by mean score"
          captionHidden
          columns={columns}
          rows={shown}
          rowKey={(row) => row.reference}
          sort={sort}
          onSortChange={setSort}
        />
      </section>

      {unrecorded > 0 && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-divider bg-surface px-1 py-2.5">
          <p className="text-body font-medium text-ink">
            {unrecorded} {unrecorded === 1 ? 'change' : 'changes'} not recorded
          </p>
          {record}
        </div>
      )}
    </div>
  );
}
