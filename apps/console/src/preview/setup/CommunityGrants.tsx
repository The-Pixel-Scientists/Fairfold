// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, DataTable, Link, PageHeader, Panel, SummaryList, Tag } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useId, useState } from 'react';

import { communityGrants } from '../story.ts';
import type { Round } from '../story.ts';
import {
  configHistory,
  dateOnly,
  hasPage,
  programmeDetails,
  roundPath,
  roundTone,
  sortableDate,
} from './data.ts';
import type { ConfigChange } from './data.ts';
import { useSort } from './sorting.ts';
import { TableSection } from './TableSection.tsx';

const columns: readonly Column<Round>[] = [
  {
    key: 'round',
    header: 'Round',
    sortable: true,
    rowHeader: true,
    cell: (round) =>
      hasPage.round(round.id) ? <Link to={roundPath(round.id)}>{round.name}</Link> : round.name,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (round) => <Tag tone={roundTone[round.status]}>{round.status}</Tag>,
  },
  {
    key: 'opens',
    header: 'Opens',
    sortable: true,
    cell: (round) => dateOnly(round.opens),
  },
  {
    key: 'closes',
    header: 'Closes',
    sortable: true,
    cell: (round) => dateOnly(round.closes),
  },
  {
    key: 'applications',
    header: 'Applications',
    align: 'end',
    sortable: true,
    cell: (round) => round.applications,
  },
  {
    key: 'budget',
    header: 'Budget',
    align: 'end',
    sortable: true,
    cell: (round) => `£${round.budget.toLocaleString('en-GB')}`,
  },
];

const sortKeys = {
  round: (round: Round) => round.name,
  opens: (round: Round) => sortableDate(round.opens),
  closes: (round: Round) => sortableDate(round.closes),
  applications: (round: Round) => round.applications,
  budget: (round: Round) => round.budget,
};

const RECENT_CHANGES = 4;

/** The change itself, field by field, before and after. */
function Diff({ change }: { change: ConfigChange }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-target cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium text-ink marker:hidden [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-3.5 text-muted transition-transform duration-(--motion-fast) group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
        See what changed<span className="sr-only"> in {change.what}</span>
      </summary>
      <dl className="mt-1 flex flex-col gap-2 border-l-2 border-divider pl-3 text-sm">
        {change.changes.map((item) => (
          <div key={item.field} className="flex flex-col gap-0.5">
            <dt className="font-medium text-ink">{item.field}</dt>
            <dd className="text-muted">Before: {item.before}</dd>
            <dd className="text-ink">After: {item.after}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function ConfigurationHistory() {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const older = configHistory.length - RECENT_CHANGES;
  const changes = showAll ? configHistory : configHistory.slice(0, RECENT_CHANGES);

  return (
    <Panel title="Configuration history">
      <p className="-mt-2 text-sm text-muted">
        Every change is saved as a version, with who made it and what changed.
      </p>
      <ol id={listId} role="list" className="flex flex-col divide-y divide-divider">
        {changes.map((change) => (
          <li key={change.iso} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
            <span className="font-medium text-ink">{change.what}</span>
            <span className="text-sm text-ink">{change.detail}</span>
            <span className="text-sm text-muted">
              {change.who}, <time dateTime={change.iso}>{change.when}</time>
            </span>
            <Diff change={change} />
          </li>
        ))}
      </ol>
      <Button
        variant="quiet"
        aria-expanded={showAll}
        aria-controls={listId}
        className="-ml-control-x self-start"
        onClick={() => {
          setShowAll((current) => !current);
        }}
      >
        {showAll ? 'Show recent changes only' : `Show ${String(older)} older changes`}
      </Button>
    </Panel>
  );
}

/** One programme: what it is for, its rounds, and who changed its set-up and when. */
export default function CommunityGrants() {
  const { sort, setSort, sorted } = useSort(communityGrants.rounds, sortKeys, {
    key: 'opens',
    direction: 'descending',
  });

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        breadcrumbs={[{ label: 'Programmes', to: '/programmes' }, { label: 'Community Grants' }]}
        eyebrow={<Tag tone="info">Design preview</Tag>}
        title="Community Grants"
        description={communityGrants.summary}
        actions={
          <>
            <Button>Edit programme</Button>
            <Button variant="primary">New round</Button>
          </>
        }
      />
      <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="about-heading" className="flex flex-col gap-3">
            <h2 id="about-heading" className="text-lg font-semibold tracking-tight text-ink">
              About this programme
            </h2>
            <SummaryList items={programmeDetails} />
          </section>
          <TableSection title="Rounds">
            <DataTable
              caption="Rounds"
              captionHidden
              columns={columns}
              rows={sorted}
              rowKey={(round) => round.id}
              {...(sort && { sort })}
              onSortChange={setSort}
            />
          </TableSection>
        </div>
        <ConfigurationHistory />
      </div>
    </div>
  );
}
