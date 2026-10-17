// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  DataTable,
  EmptyState,
  Link,
  PageHeader,
  useLoad,
  useSort,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { programmeStatuses } from '../../contracts/index.ts';
import type { ProgrammeList, Round } from '../../contracts/index.ts';
import { formatLocalDay } from './format.ts';
import { loadProgrammes } from './loaders.ts';
import { LinkButton, ManagePage, None, StatusTag } from './Page.tsx';
import { NEW_PROGRAMME_PATH, programmePath, roundPath } from './paths.ts';

type Row = ProgrammeList['programmes'][number];

/** The round that opened last, which is the one a programme is running now. */
function latestRound(row: Row): Round | undefined {
  return row.rounds.reduce<Round | undefined>(
    (latest, round) => (latest === undefined || round.opensAt > latest.opensAt ? round : latest),
    undefined,
  );
}

const columns: readonly Column<Row>[] = [
  {
    key: 'programme',
    header: 'Programme',
    sortable: true,
    rowHeader: true,
    cell: (row) => (
      <span className="flex min-w-48 max-w-96 flex-col whitespace-normal">
        <Link to={programmePath(row.id)}>{row.title}</Link>
        <span className="text-sm font-normal text-muted">{row.summary}</span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortable: true,
    cell: (row) => <StatusTag status={row.status} />,
  },
  {
    key: 'round',
    header: 'Latest round',
    cell: (row) => {
      const round = latestRound(row);
      return round === undefined ? (
        'No rounds yet'
      ) : (
        <Link to={roundPath(round.id)}>{round.title}</Link>
      );
    },
  },
  {
    key: 'closes',
    header: 'Closes',
    sortable: true,
    cell: (row) => {
      const round = latestRound(row);
      return round === undefined ? <None /> : formatLocalDay(round.closesAt);
    },
  },
  {
    key: 'budget',
    header: 'Budget',
    align: 'end',
    sortable: true,
    cell: (row) => {
      const round = latestRound(row);
      return round === undefined ? <None /> : formatMoney(round.budget);
    },
  },
];

const sortKeys = {
  programme: (row: Row) => row.title,
  status: (row: Row) => programmeStatuses[row.status],
  closes: (row: Row) => latestRound(row)?.closesAt ?? '',
  budget: (row: Row) => latestRound(row)?.budget.amountMinor ?? 0,
};

function ProgrammeTable({ programmes }: { programmes: ProgrammeList['programmes'] }) {
  const { sort, setSort, sorted } = useSort(programmes, sortKeys, {
    key: 'programme',
    direction: 'ascending',
  });
  return (
    <DataTable
      caption="Programmes"
      captionHidden
      columns={columns}
      rows={sorted}
      rowKey={(row) => row.id}
      {...(sort && { sort })}
      onSortChange={setSort}
    />
  );
}

function Programmes() {
  const { state, retry } = useLoad(loadProgrammes);
  return (
    <>
      <PageHeader
        title="Programmes"
        description="Each programme is a grant you run, with its rounds, stages, rubrics and emails. Open one to set up its next round."
        actions={
          <LinkButton to={NEW_PROGRAMME_PATH} variant="primary">
            New programme
          </LinkButton>
        }
      />
      <WhenLoaded state={state} label="Loading programmes" retry={retry}>
        {({ programmes }) =>
          programmes.length === 0 ? (
            <EmptyState
              title="No programmes yet"
              action={<LinkButton to={NEW_PROGRAMME_PATH}>Create a programme</LinkButton>}
            >
              <p>
                A programme is one grant you run, such as Community Spaces Fund. Create one, then
                add a round with its dates, budget and stages.
              </p>
            </EmptyState>
          ) : (
            <ProgrammeTable programmes={programmes} />
          )
        }
      </WhenLoaded>
    </>
  );
}

/** The funder's programmes, each with the round it is running now. */
export default function ProgrammesPage() {
  return (
    <ManagePage title="Programmes">
      <Programmes />
    </ManagePage>
  );
}
