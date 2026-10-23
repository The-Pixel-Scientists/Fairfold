// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buttonClassName,
  DataTable,
  EmptyState,
  Link,
  Meter,
  PageHeader,
  ShortcutsDialog,
  Stats,
  Tag,
  useLoad,
  useLocation,
  useNavigate,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column, ShortcutGroup } from '@pixel-scientists/ui';
import { useState } from 'react';

import type { ReviewSummary } from '../../contracts/index.ts';
import { FilterTabs } from './FilterTabs.tsx';
import { loadReviews } from './loaders.ts';
import { ScorePage } from './Page.tsx';
import { reviewPath } from './paths.ts';
import {
  applicationName,
  countOf,
  formatDay,
  reviewActions,
  reviewStateOf,
  reviewStateTones,
  reviewStateWords,
} from './words.ts';

type Filter = 'all' | 'todo' | 'submitted';

const shortcuts: readonly ShortcutGroup[] = [
  {
    title: 'In the table',
    shortcuts: [
      { keys: ['Arrow up', 'Arrow down'], does: 'Move to the row above or below' },
      { keys: ['Home', 'End'], does: 'Move to the first or last row' },
      { keys: ['Enter'], does: 'Open the review' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
];

const columns: readonly Column<ReviewSummary>[] = [
  {
    key: 'application',
    header: 'Application',
    rowHeader: true,
    cell: (review) => (
      <Link to={reviewPath(review.id)} className="font-medium tabular-nums">
        {applicationName(review.applicationId)}
      </Link>
    ),
  },
  {
    key: 'round',
    header: 'Round',
    cell: (review) => (
      <span className="flex flex-col">
        {review.round.title}
        <span className="text-sm text-muted">{review.programme.title}</span>
      </span>
    ),
  },
  { key: 'stage', header: 'Stage', cell: (review) => review.stage.name },
  {
    key: 'status',
    header: 'Status',
    cell: (review) => {
      const state = reviewStateOf(review);
      return (
        <div className="flex flex-col items-start gap-1">
          <Tag tone={reviewStateTones[state]}>{reviewStateWords[state]}</Tag>
          <span className="text-sm text-muted">
            {state === 'submitted' && review.submittedAt !== null
              ? `Submitted on ${formatDay(review.submittedAt)}`
              : `${String(review.progress.scored)} of ${countOf(review.progress.total, 'criterion', 'criteria')} scored`}
          </span>
        </div>
      );
    },
  },
  { key: 'assigned', header: 'Assigned', cell: (review) => formatDay(review.assignedAt) },
  {
    key: 'action',
    header: <span className="sr-only">Action</span>,
    align: 'end',
    cell: (review) => {
      const state = reviewStateOf(review);
      return (
        <Link
          to={reviewPath(review.id)}
          className={buttonClassName(state === 'submitted' ? 'quiet' : 'secondary', 'no-underline')}
        >
          {reviewActions[state]}
          <span className="sr-only">: {applicationName(review.applicationId)}</span>
        </Link>
      );
    },
  },
];

function Reviews({ reviews }: { reviews: readonly ReviewSummary[] }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [help, setHelp] = useState(false);
  const todo = reviews.filter((review) => review.status !== 'submitted');
  const done = reviews.length - todo.length;
  const started = todo.filter((review) => reviewStateOf(review) === 'in progress').length;
  const shown = { all: reviews, todo, submitted: reviews.filter((r) => r.status === 'submitted') }[
    filter
  ];

  if (reviews.length === 0) {
    return (
      <EmptyState title="No reviews yet">
        <p>
          A programme manager assigns applications to you. When they do, they appear here, and you
          can open each one to score it.
        </p>
      </EmptyState>
    );
  }

  return (
    <>
      <Stats
        label="Your reviews"
        items={[
          { label: 'Assigned to you', value: reviews.length },
          { label: 'Submitted', value: done },
          {
            label: 'To do',
            value: todo.length,
            detail: `${String(started)} in progress, ${String(todo.length - started)} not started`,
          },
        ]}
      />
      <Meter
        label="Your progress"
        value={done}
        max={reviews.length}
        valueText={`${String(done)} of ${countOf(reviews.length, 'review')} submitted`}
      />
      <div className="flex flex-col gap-3">
        <FilterTabs<Filter>
          label="Show reviews"
          options={[
            { value: 'all', label: 'All', count: reviews.length },
            { value: 'todo', label: 'To do', count: todo.length },
            { value: 'submitted', label: 'Submitted', count: done },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {shown.length === 0 ? (
          <EmptyState title={filter === 'todo' ? 'Nothing left to do' : 'Nothing submitted yet'}>
            <p>
              {filter === 'todo'
                ? 'You have submitted every review assigned to you.'
                : 'Reviews you submit appear here.'}
            </p>
          </EmptyState>
        ) : (
          <DataTable
            caption="Reviews assigned to you"
            captionHidden
            columns={columns}
            rows={shown}
            rowKey={(review) => review.id}
            onOpenRow={(review) => {
              navigate(reviewPath(review.id));
            }}
            onHelp={() => {
              setHelp(true);
            }}
          />
        )}
      </div>
      <ShortcutsDialog
        open={help}
        onOpenChange={setHelp}
        groups={shortcuts}
        description="These work when a row of the table has focus. Press Tab to reach the table, then Tab again to reach its first row."
      />
    </>
  );
}

/** Says a conflict was declared, when the person has just come from declaring one. It follows the page's heading, which the router focuses. */
function ConflictNotice() {
  const declared = new URLSearchParams(useLocation().search).get('conflict') === 'declared';
  if (!declared) return null;
  return (
    <p
      role="status"
      className="rounded-md border border-divider bg-success-soft px-3 py-2 text-body text-ink"
    >
      You declared a conflict, so the application has left your list. Staff have been told.
    </p>
  );
}

function MyReviews() {
  const { state, retry } = useLoad(loadReviews);
  return (
    <>
      <PageHeader
        title="My reviews"
        description="Applications assigned to you. Review is blind: you see each application by its reference and round, never who is behind it."
      />
      <ConflictNotice />
      <p className="max-w-prose text-body text-muted">
        Know the applicant? Open the application and choose Declare a conflict. It leaves your list
        and you do not score it.
      </p>
      <WhenLoaded state={state} label="Loading your reviews" retry={retry}>
        {({ reviews }) => <Reviews reviews={reviews} />}
      </WhenLoaded>
    </>
  );
}

/** A reviewer's inbox: the applications assigned to them, what is done and what is next. */
export default function MyReviewsPage() {
  return (
    <ScorePage title="My reviews">
      <MyReviews />
    </ScorePage>
  );
}
