// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, DataTable, Link, PageHeader, Stats, Tag } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import {
  awardedSince2024,
  comingUp,
  currentBudget,
  dateOnly,
  hasPage,
  millions,
  programmeRows,
  roundsOpen,
  roundTone,
  sortableDate,
} from './data.ts';
import type { Milestone, ProgrammeRow } from './data.ts';
import { useSort } from './sorting.ts';
import { TableSection } from './TableSection.tsx';

const columns: readonly Column<ProgrammeRow>[] = [
  {
    key: 'programme',
    header: 'Programme',
    sortable: true,
    rowHeader: true,
    cell: (row) => (
      <span className="flex flex-col">
        {hasPage.programme(row.id) ? (
          <Link to={`/programmes/${row.id}`}>{row.name}</Link>
        ) : (
          row.name
        )}
        <span className="text-sm font-normal text-muted">{row.awards}</span>
      </span>
    ),
  },
  { key: 'round', header: 'Current round', cell: (row) => row.round.name },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <Tag tone={roundTone[row.round.status]}>{row.round.status}</Tag>,
  },
  {
    key: 'applications',
    header: 'Applications',
    align: 'end',
    sortable: true,
    cell: (row) => row.round.applications,
  },
  {
    key: 'budget',
    header: 'Budget',
    align: 'end',
    sortable: true,
    cell: (row) => `£${row.round.budget.toLocaleString('en-GB')}`,
  },
  {
    key: 'closes',
    header: 'Closes',
    sortable: true,
    cell: (row) => dateOnly(row.round.closes),
  },
  { key: 'next', header: 'Next step', cell: (row) => row.next },
];

const milestoneColumns: readonly Column<Milestone>[] = [
  { key: 'date', header: 'Date', rowHeader: true, cell: (item) => item.date },
  { key: 'programme', header: 'Programme', cell: (item) => item.programme },
  { key: 'what', header: 'What happens', cell: (item) => item.what },
];

const sortKeys = {
  programme: (row: ProgrammeRow) => row.name,
  applications: (row: ProgrammeRow) => row.round.applications,
  budget: (row: ProgrammeRow) => row.round.budget,
  closes: (row: ProgrammeRow) => sortableDate(row.round.closes),
};

/** The funder's programmes, each with the round it is running now. */
export default function Programmes() {
  const { sort, setSort, sorted } = useSort(programmeRows, sortKeys, {
    key: 'programme',
    direction: 'ascending',
  });

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        eyebrow={<Tag tone="info">Design preview</Tag>}
        title="Programmes"
        description="Each programme is a grant you run, with its rounds, forms and reviewers. Open one to set up its next round."
        actions={<Button variant="primary">New programme</Button>}
      />
      <Stats
        label="Programmes at a glance"
        items={[
          {
            label: 'Programmes',
            value: programmeRows.length,
            detail: 'Youth Futures not open yet',
          },
          {
            label: 'Rounds open',
            value: roundsOpen.count,
            detail: roundsOpen.detail,
          },
          {
            label: 'Budget in current rounds',
            value: millions(currentBudget.total),
            detail: currentBudget.detail,
          },
          {
            label: 'Awarded since 2024',
            value: millions(awardedSince2024),
            detail: 'Includes grants imported from before July 2026',
          },
        ]}
      />
      <TableSection title="Current round of each programme">
        <DataTable
          caption="Current round of each programme"
          captionHidden
          columns={columns}
          rows={sorted}
          rowKey={(row) => row.id}
          {...(sort && { sort })}
          onSortChange={setSort}
        />
      </TableSection>
      <TableSection title="Coming up">
        <DataTable
          caption="Coming up"
          captionHidden
          columns={milestoneColumns}
          rows={comingUp}
          rowKey={(item) => `${item.date}:${item.what}`}
        />
      </TableSection>
    </div>
  );
}
