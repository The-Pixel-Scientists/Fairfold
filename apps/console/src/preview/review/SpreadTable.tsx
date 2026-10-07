// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The spread table, with rows that open to show how each reviewer scored
// each criterion. The kit's DataTable has no expandable rows, so this keeps
// its markup and classes and adds the disclosure.

import { Link, Tag, cx } from '@pixel-scientists/ui';
import { Fragment, useId } from 'react';

import { mean, range, round1, WIDE_SPREAD } from './data.ts';
import type { Row } from './data.ts';
import { RangeBar } from './RangeBar.tsx';
import { reviewScores } from './scoring.ts';
import { criteria } from '../story.ts';

const cell = 'px-3 py-2 whitespace-nowrap';
const head = 'px-3 py-2 text-sm font-medium whitespace-nowrap text-muted';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cx(
        'size-3.5 shrink-0 transition-transform duration-(--motion-fast)',
        open && 'rotate-90',
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </svg>
  );
}

/** Every reviewer's score for each criterion, and how far apart the reviewers are on each. */
function Breakdown({ item }: { item: Row }) {
  const reviews = reviewScores(item);
  const gaps = criteria.map((_, index) => {
    const scores = reviews.map((review) => review.scores[index] ?? 0);
    return Math.max(...scores) - Math.min(...scores);
  });
  const widest = Math.max(...gaps);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-ink">
        <span className="font-medium">{item.project}</span>
        <span className="text-muted">: scores by reviewer and criterion, each from 1 to 5</span>
      </p>
      <div className="relative overflow-x-auto">
        <table className="min-w-full border-collapse text-body">
          <caption className="sr-only">Scores for {item.project} by reviewer and criterion</caption>
          <thead>
            <tr className="border-b border-edge/40">
              <th scope="col" className={cx(head, 'text-start')}>
                Reviewer
              </th>
              {criteria.map((criterion) => (
                <th key={criterion.id} scope="col" className={cx(head, 'text-end')}>
                  {criterion.label}
                  <span className="ml-1 text-xs font-normal">
                    <span aria-hidden="true">×{criterion.weight}</span>
                    <span className="sr-only">, weight {criterion.weight}</span>
                  </span>
                </th>
              ))}
              <th scope="col" className={cx(head, 'text-end')}>
                Weighted total
              </th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((review) => (
              <tr key={review.reviewer} className="border-b border-divider">
                <th scope="row" className={cx(cell, 'text-start font-medium')}>
                  {review.reviewer}
                </th>
                {review.scores.map((score, index) => (
                  <td key={criteria[index]?.id} className={cx(cell, 'text-end tabular-nums')}>
                    {score}
                  </td>
                ))}
                <td className={cx(cell, 'text-end font-semibold tabular-nums')}>
                  {review.total.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={cx(cell, 'text-start font-medium text-muted')}>
                Gap between highest and lowest
              </th>
              {gaps.map((gap, index) => (
                <td key={criteria[index]?.id} className={cx(cell, 'text-end tabular-nums')}>
                  <span className={gap === widest ? 'font-semibold text-ink' : 'text-muted'}>
                    {gap}
                  </span>
                  {gap === widest && gap > 1 && (
                    <span className="block text-xs font-medium text-warning">Widest gap</span>
                  )}
                </td>
              ))}
              <td className={cx(cell, 'text-end font-semibold tabular-nums')}>
                {range(item).toFixed(1)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export interface SpreadTableProps {
  rows: readonly Row[];
  /** The references of the rows that are open. */
  open: ReadonlySet<string>;
  onToggle: (reference: string) => void;
}

export function SpreadTable({ rows, open, onToggle }: SpreadTableProps) {
  const captionId = useId();
  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className="@container relative overflow-x-auto"
    >
      <table className="min-w-full border-collapse text-body">
        <caption id={captionId} className="sr-only">
          Score spread for each submission in the Spring 2027 round
        </caption>
        <thead>
          <tr className="border-b border-edge/40">
            <th scope="col" className={cx(head, 'text-start')}>
              <span className="sr-only">Scores by criterion</span>
            </th>
            <th scope="col" className={cx(head, 'text-start')}>
              Reference
            </th>
            <th scope="col" className={cx(head, 'text-start')}>
              Project
            </th>
            <th scope="col" className={cx(head, 'text-end')}>
              Reviews
            </th>
            <th scope="col" className={cx(head, 'text-end')}>
              Lowest
            </th>
            <th scope="col" className={cx(head, 'text-end')}>
              Highest
            </th>
            <th scope="col" className={cx(head, 'text-start')}>
              Spread
            </th>
            <th scope="col" className={cx(head, 'text-end')}>
              Range
            </th>
            <th scope="col" className={cx(head, 'text-end')}>
              Mean
            </th>
            <th scope="col" className={cx(head, 'text-start')}>
              Flag
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const spread = range(item);
            const wide = spread >= WIDE_SPREAD;
            const expanded = open.has(item.reference);
            const detailId = `breakdown-${item.reference}`;
            return (
              <Fragment key={item.reference}>
                <tr
                  className={cx(
                    'transition-colors duration-(--motion-fast) ease-standard hover:bg-sunken/60',
                    !expanded && 'border-b border-divider',
                  )}
                >
                  <td className={cell}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      onClick={() => {
                        onToggle(item.reference);
                      }}
                      className="-mx-1 inline-flex min-h-target items-center gap-1.5 rounded-sm px-1 font-medium text-accent hover:bg-accent-soft"
                    >
                      <Chevron open={expanded} />
                      {expanded ? 'Hide scores' : 'Show scores'}
                      <span className="sr-only"> for {item.project}</span>
                    </button>
                  </td>
                  <td className={cx(cell, 'text-muted tabular-nums')}>{item.reference}</td>
                  <th scope="row" className={cx(cell, 'text-start font-medium')}>
                    <Link
                      to={`/submissions/${item.reference}`}
                      className="text-ink no-underline hover:text-ink hover:underline"
                    >
                      {item.project}
                    </Link>
                  </th>
                  <td className={cx(cell, 'text-end tabular-nums')}>
                    {item.totals.length} of {item.reviews.assigned}
                  </td>
                  <td className={cx(cell, 'text-end tabular-nums')}>
                    {Math.min(...item.totals).toFixed(1)}
                  </td>
                  <td className={cx(cell, 'text-end tabular-nums')}>
                    {Math.max(...item.totals).toFixed(1)}
                  </td>
                  <td className={cell}>
                    <RangeBar totals={item.totals} wide={wide} />
                  </td>
                  <td className={cx(cell, 'text-end tabular-nums', wide && 'font-semibold')}>
                    {spread.toFixed(1)}
                  </td>
                  <td className={cx(cell, 'text-end tabular-nums')}>
                    {round1(mean(item.totals)).toFixed(1)}
                  </td>
                  <td className={cell}>
                    {wide ? (
                      <Tag tone="warning">Wide spread</Tag>
                    ) : (
                      <span className="text-muted">Under 1.5</span>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr id={detailId} className="border-b border-divider">
                    <td colSpan={10} className="bg-sunken/50 px-3 py-4">
                      <Breakdown item={item} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
