// SPDX-License-Identifier: AGPL-3.0-or-later

import { DataTable, Panel } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { criteria } from '../../story.ts';
import { comments, reference } from '../featured.ts';
import { rows, range } from '../data.ts';
import { reviewScores } from '../scoring.ts';
import type { ReviewScores } from '../scoring.ts';

const item = rows.find((row) => row.reference === reference);
const reviews = item ? reviewScores(item) : [];
const submitted = new Map<string, string>(
  comments.map((comment) => [comment.reviewer, comment.submitted]),
);

const columns: readonly Column<ReviewScores>[] = [
  {
    key: 'reviewer',
    header: 'Reviewer',
    rowHeader: true,
    cell: (review) => (
      <div className="flex flex-col">
        <span>{review.reviewer}</span>
        <span className="text-sm font-normal text-muted">
          Submitted {submitted.get(review.reviewer)}
        </span>
      </div>
    ),
  },
  ...criteria.map((criterion, index): Column<ReviewScores> => ({
    key: criterion.id,
    header: (
      <span className="inline-flex flex-col items-end leading-tight">
        <span>
          {criterion.label.split(' ', 1)[0]}
          <span className="sr-only">{criterion.label.replace(/^\S+/, '')}</span>
        </span>
        <span className="text-xs font-normal text-muted">
          <span aria-hidden="true">×{criterion.weight}</span>
          <span className="sr-only">, weight {criterion.weight}</span>
        </span>
      </span>
    ),
    align: 'end',
    cell: (review) => review.scores[index],
  })),
  {
    key: 'total',
    header: (
      <span className="inline-flex flex-col items-end leading-tight">
        <span>Total</span>
        <span className="text-xs font-normal text-muted">out of 5</span>
      </span>
    ),
    align: 'end',
    cell: (review) => <span className="font-semibold">{review.total.toFixed(1)}</span>,
  },
];

/** Each reviewer's scores and comment. Staff see who scored what; the applicant never does. */
export function ReviewsTab() {
  return (
    <div className="flex flex-col gap-5">
      <DataTable
        caption="Reviews of Riverside Lunch Club"
        columns={columns}
        rows={reviews}
        rowKey={(review) => review.reviewer}
      />
      {item && (
        <p className="max-w-prose text-body text-muted">
          Each criterion is scored 1 to 5, and the number after its name is its weight. The
          reviewers' totals are {range(item).toFixed(1)} apart, below the 1.5 that is flagged as a
          wide spread.
        </p>
      )}
      <Panel title="Reviewers' comments" headingLevel="h2">
        <ul className="flex flex-col divide-y divide-divider">
          {comments.map((comment) => (
            <li key={comment.reviewer} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium text-ink">{comment.reviewer}</span>
                <span className="text-sm text-muted">{comment.submitted}</span>
              </p>
              <p className="max-w-prose text-body text-ink">{comment.text}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
