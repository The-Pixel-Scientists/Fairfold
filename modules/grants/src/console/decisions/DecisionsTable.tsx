// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatMoney } from '@pixel-scientists/domain/platform';
import { Button, DataTable, Link, useSort } from '@pixel-scientists/ui';
import type { Column, RowSelection } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import type { DecisionRow } from '../../contracts/index.ts';
import { submissionPath } from '../submissions/paths.ts';
import { countOf } from './totals.ts';
import { Missing, OutcomeTag, ReleaseState } from './words.tsx';

const isReleased = (row: DecisionRow) => (row.decision?.releasedAt ?? null) !== null;

/** What a column sorts by. A submission with no score or amount sorts below those with one. */
const sortKeys = {
  organisation: (row: DecisionRow) => row.organisation.name,
  score: (row: DecisionRow) => row.meanScore ?? -1,
  outcome: (row: DecisionRow) => row.decision?.outcome ?? '',
  amount: (row: DecisionRow) => row.decision?.amount?.amountMinor ?? -1,
  release: (row: DecisionRow) => (isReleased(row) ? 1 : 0),
};

export interface DecisionsTableProps {
  rows: readonly DecisionRow[];
  selection: RowSelection<DecisionRow>;
  /** Shown when the filter leaves no rows. */
  empty: ReactNode;
  onRecord: (row: DecisionRow) => void;
  onPreview: (row: DecisionRow) => void;
  onHelp: () => void;
}

/** A round's submissions with their scores and decisions, in the order the API gave them until a heading is pressed. */
export function DecisionsTable({
  rows,
  selection,
  empty,
  onRecord,
  onPreview,
  onHelp,
}: DecisionsTableProps) {
  const { sort, setSort, sorted } = useSort(rows, sortKeys);

  const columns: readonly Column<DecisionRow>[] = [
    {
      key: 'organisation',
      header: 'Organisation',
      rowHeader: true,
      sortable: true,
      cell: (row) => (
        <span className="flex min-w-40 max-w-80 flex-col whitespace-normal">
          <Link to={submissionPath(row.submissionId)}>{row.organisation.name}</Link>
          <span className="text-sm font-normal text-muted">{row.stage.name}</span>
        </span>
      ),
    },
    {
      key: 'score',
      header: 'Mean score',
      align: 'end',
      sortable: true,
      cell: (row) =>
        row.meanScore === null ? (
          <Missing>No reviews yet</Missing>
        ) : (
          <span className="flex flex-col items-end">
            <span>{row.meanScore.toFixed(2)}</span>
            <span className="text-sm text-muted">{countOf(row.reviews, 'review')}</span>
          </span>
        ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      sortable: true,
      cell: (row) => <OutcomeTag decision={row.decision} />,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'end',
      sortable: true,
      cell: (row) =>
        row.decision?.amount ? formatMoney(row.decision.amount) : <Missing>No amount</Missing>,
    },
    {
      key: 'release',
      header: 'Release',
      sortable: true,
      cell: (row) => <ReleaseState row={row} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (row) => (
        <span className="flex justify-end gap-1">
          {!isReleased(row) && (
            <Button
              variant="quiet"
              onClick={() => {
                onRecord(row);
              }}
            >
              {row.decision ? 'Change decision' : 'Record decision'}
              <span className="sr-only"> for {row.organisation.name}</span>
            </Button>
          )}
          {row.decision && (
            <Button
              variant="quiet"
              onClick={() => {
                onPreview(row);
              }}
            >
              Preview email<span className="sr-only"> for {row.organisation.name}</span>
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption="Submissions and their decisions"
      captionHidden
      columns={columns}
      rows={sorted}
      rowKey={(row) => row.submissionId}
      sort={sort}
      onSortChange={setSort}
      selection={selection}
      onOpenRow={(row) => {
        if (!isReleased(row)) onRecord(row);
      }}
      onHelp={onHelp}
      empty={empty}
    />
  );
}
