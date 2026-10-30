// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  buttonClassName,
  DataTable,
  EmptyState,
  Link,
  PageHeader,
  ShortcutsDialog,
  Stats,
  Tag,
  useLoad,
  useSort,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column, ShortcutGroup } from '@pixel-scientists/ui';
import { useState } from 'react';

import type { SpreadRow } from '../../contracts/index.ts';
import { PROGRAMMES_PATH, programmePath, roundPath } from '../programme/paths.ts';
import { SUBMISSIONS_PATH, submissionPath } from '../submissions/paths.ts';
import { FilterTabs } from './FilterTabs.tsx';
import { loadSpreadPage } from './loaders.ts';
import { AssignPage, useParam } from './Page.tsx';
import { reviewersPath } from './paths.ts';
import { RangeBar } from './RangeBar.tsx';
import { ScoresDialog } from './ScoresDialog.tsx';
import { barScale, figuresOf } from './spread.ts';
import { formatScore, isWide, WIDE_SPREAD } from './words.ts';

type Filter = 'all' | 'wide';

const shortcuts: readonly ShortcutGroup[] = [
  {
    title: 'In the table',
    shortcuts: [
      { keys: ['Arrow up', 'Arrow down'], does: 'Move to the row above or below' },
      { keys: ['Home', 'End'], does: 'Move to the first or last row' },
      { keys: ['Enter'], does: 'Show how each reviewer scored the submission' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
];

/** A column for a figure a submission may not have yet. A screen reader hears "None", not a dash. */
const figure = (value: number | null) =>
  value === null ? (
    <>
      <span aria-hidden="true">–</span>
      <span className="sr-only">None</span>
    </>
  ) : (
    formatScore(value)
  );

/** What a column sorts by. A submission with no score yet sorts below those with one. */
const sortKeys = {
  organisation: (row: SpreadRow) => row.organisation.name,
  stage: (row: SpreadRow) => row.stage.name,
  reviews: (row: SpreadRow) => row.submitted,
  lowest: (row: SpreadRow) => row.lowest ?? -1,
  highest: (row: SpreadRow) => row.highest ?? -1,
  range: (row: SpreadRow) => row.range ?? -1,
  mean: (row: SpreadRow) => row.mean ?? -1,
};

function columns(scale: number, onShow: (row: SpreadRow) => void): readonly Column<SpreadRow>[] {
  return [
    {
      key: 'organisation',
      header: 'Organisation',
      rowHeader: true,
      sortable: true,
      cell: (row) => (
        <Link to={submissionPath(row.submissionId)} className="block min-w-40 whitespace-normal">
          {row.organisation.name}
        </Link>
      ),
    },
    { key: 'stage', header: 'Stage', sortable: true, cell: (row) => row.stage.name },
    {
      key: 'reviews',
      header: 'Reviews',
      align: 'end',
      sortable: true,
      cell: (row) => (
        <span className="tabular-nums">
          {row.submitted} of {row.assigned}
        </span>
      ),
    },
    {
      key: 'lowest',
      header: 'Lowest',
      align: 'end',
      sortable: true,
      cell: (row) => <span className="tabular-nums">{figure(row.lowest)}</span>,
    },
    {
      key: 'highest',
      header: 'Highest',
      align: 'end',
      sortable: true,
      cell: (row) => <span className="tabular-nums">{figure(row.highest)}</span>,
    },
    {
      key: 'spread',
      header: 'Spread',
      cell: (row) => <RangeBar totals={row.totals} scale={scale} wide={isWide(row)} />,
    },
    {
      key: 'range',
      header: 'Range',
      align: 'end',
      sortable: true,
      cell: (row) => (
        <span className={isWide(row) ? 'font-semibold tabular-nums' : 'tabular-nums'}>
          {figure(row.range)}
        </span>
      ),
    },
    {
      key: 'mean',
      header: 'Mean',
      align: 'end',
      sortable: true,
      cell: (row) => <span className="tabular-nums">{figure(row.mean)}</span>,
    },
    {
      key: 'flag',
      header: 'Flag',
      cell: (row) =>
        isWide(row) ? (
          <Tag tone="warning">Wide spread</Tag>
        ) : row.submitted < 2 ? (
          <span className="text-muted">Needs two reviews</span>
        ) : (
          <span className="text-muted">Under {formatScore(WIDE_SPREAD)}</span>
        ),
    },
    {
      key: 'scores',
      header: <span className="sr-only">Scores</span>,
      align: 'end',
      cell: (row) => (
        <Button
          variant="quiet"
          onClick={() => {
            onShow(row);
          }}
        >
          Show scores<span className="sr-only"> for {row.organisation.name}</span>
        </Button>
      ),
    },
  ];
}

function Spread({ rows }: { rows: readonly SpreadRow[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [showing, setShowing] = useState<SpreadRow | null>(null);
  const [help, setHelp] = useState(false);
  const figures = figuresOf(rows);
  const shown = filter === 'wide' ? rows.filter(isWide) : rows;
  const { sort, setSort, sorted } = useSort(shown, sortKeys, {
    key: 'range',
    direction: 'descending',
  });

  return (
    <>
      <Stats
        label="Review progress"
        items={[
          {
            label: 'Reviews submitted',
            value: `${String(figures.submitted)} of ${String(figures.assigned)}`,
            detail: `${String(figures.assigned - figures.submitted)} still to come`,
          },
          { label: 'Two or more reviews', value: figures.compared, detail: 'Submissions' },
          {
            label: 'Wide spreads',
            value: figures.wide,
            detail: `A range of ${formatScore(WIDE_SPREAD)} or more`,
          },
          {
            label: 'Median range',
            value: figures.medianRange === null ? 'None yet' : formatScore(figures.medianRange),
          },
        ]}
      />
      <div className="flex flex-col gap-3">
        <FilterTabs<Filter>
          label="Show submissions"
          options={[
            { value: 'all', label: 'All with reviewers', count: rows.length },
            { value: 'wide', label: 'Wide spread', count: figures.wide },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <DataTable
          caption="Score spread for each submission"
          captionHidden
          columns={columns(barScale(rows), setShowing)}
          rows={sorted}
          rowKey={(row) => `${row.submissionId}:${row.stage.id}`}
          sort={sort}
          onSortChange={setSort}
          onOpenRow={setShowing}
          onHelp={() => {
            setHelp(true);
          }}
          empty={
            <EmptyState title="No wide spreads">
              <p>
                Reviewers are within {formatScore(WIDE_SPREAD)} of each other on every submission
                that has two reviews so far.
              </p>
            </EmptyState>
          }
        />
        <p className="text-sm text-muted">
          Totals are weighted: each criterion&apos;s score times its weight, over the total weight.
          Only submitted reviews count.
        </p>
      </div>
      <ScoresDialog
        row={showing}
        onClose={() => {
          setShowing(null);
        }}
      />
      <ShortcutsDialog
        open={help}
        onOpenChange={setHelp}
        groups={shortcuts}
        description="These work when a row of the table has focus. Press Tab to reach the table, then Tab again to reach its first row."
      />
    </>
  );
}

function ScoreSpread({ roundId }: { roundId: string }) {
  const { state, retry } = useLoad(loadSpreadPage, roundId);
  const names = state.status === 'ready' ? state.value.names : null;

  return (
    <>
      <PageHeader
        breadcrumbs={
          names
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                { label: names.programme.title, to: programmePath(names.programme.id) },
                { label: names.round.title, to: roundPath(roundId) },
                { label: 'Score spread' },
              ]
            : undefined
        }
        title="Score spread"
        description={`How far apart reviewers' weighted totals are on each submission${names ? ` to ${names.round.title}` : ''}. A range of ${formatScore(WIDE_SPREAD)} or more is flagged: a prompt to talk it through before deciding, not a verdict.`}
        actions={
          <Link to={reviewersPath(roundId)} className={buttonClassName()}>
            Reviewers
          </Link>
        }
      />
      <WhenLoaded state={state} label="Loading scores" retry={retry}>
        {({ rows }) =>
          rows.length === 0 ? (
            <EmptyState
              title="No reviewers are assigned yet"
              action={
                <Link to={`${SUBMISSIONS_PATH}?roundId=${roundId}`} className={buttonClassName()}>
                  Go to submissions
                </Link>
              }
            >
              <p>
                Scores appear here once submissions have reviewers. Assign reviewers from the
                submissions in this round.
              </p>
            </EmptyState>
          ) : (
            <Spread key={roundId} rows={rows} />
          )
        }
      </WhenLoaded>
    </>
  );
}

/** How far apart reviewers' scores are on each submission in a round, so staff can talk through the wide ones before deciding. */
export default function SpreadPage() {
  return (
    <AssignPage title="Score spread">
      <ScoreSpread roundId={useParam('roundId')} />
    </AssignPage>
  );
}
