// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, cx, Dialog, EmptyState, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useId } from 'react';

import type { SpreadRow, SubmissionScores } from '../../contracts/index.ts';
import { loadScores } from './loaders.ts';
import { gapOf } from './spread.ts';
import { formatScore, nameOf } from './words.ts';

const cell = 'px-3 py-2 whitespace-nowrap';
const head = 'px-3 py-2 text-sm font-medium whitespace-nowrap text-muted';

type Stage = SubmissionScores['stages'][number];

/** Every reviewer's score for each criterion, and how far apart the reviewers are on each. */
function ScoresTable({ stage, organisation }: { stage: Stage; organisation: string }) {
  const captionId = useId();
  const { criteria, reviews } = stage;
  const scoreOf = (review: Stage['reviews'][number], criterionId: string) =>
    review.scores.find((score) => score.criterionId === criterionId)?.score;
  const gaps = criteria.map((criterion) =>
    gapOf(reviews.flatMap((review) => scoreOf(review, criterion.id) ?? [])),
  );
  const widest = Math.max(0, ...gaps.map((gap) => gap ?? 0));
  const totalGap = gapOf(reviews.map((review) => review.weightedTotal));

  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className="relative overflow-x-auto"
    >
      <table className="min-w-full border-collapse text-body">
        <caption id={captionId} className="sr-only">
          Scores for {organisation} at {stage.stage.name}, by reviewer and criterion
        </caption>
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
            <tr key={review.assignmentId} className="border-b border-divider">
              <th scope="row" className={cx(cell, 'text-start font-medium')}>
                {nameOf(review.reviewer.name)}
              </th>
              {criteria.map((criterion) => (
                <td key={criterion.id} className={cx(cell, 'text-end tabular-nums')}>
                  {scoreOf(review, criterion.id) ?? '–'}
                </td>
              ))}
              <td className={cx(cell, 'text-end font-semibold tabular-nums')}>
                {formatScore(review.weightedTotal)}
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
                {gap === null ? (
                  '–'
                ) : (
                  <>
                    <span
                      className={
                        gap === widest && gap > 0 ? 'font-semibold text-ink' : 'text-muted'
                      }
                    >
                      {gap}
                    </span>
                    {gap === widest && gap > 1 && (
                      <span className="block text-xs font-medium text-warning">Widest gap</span>
                    )}
                  </>
                )}
              </td>
            ))}
            <td className={cx(cell, 'text-end font-semibold tabular-nums')}>
              {totalGap === null ? '–' : formatScore(totalGap)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Scores({ row, onClose }: { row: SpreadRow; onClose: () => void }) {
  const { state, retry } = useLoad(loadScores, row.submissionId);
  return (
    <WhenLoaded state={state} label="Loading scores" retry={retry}>
      {({ stages }) => {
        const stage = stages.find((item) => item.stage.id === row.stage.id);
        return (
          <>
            {stage === undefined || stage.reviews.length === 0 ? (
              <EmptyState title="No submitted reviews yet" headingLevel="h3">
                <p>Scores appear here when a reviewer submits their review.</p>
              </EmptyState>
            ) : (
              <ScoresTable stage={stage} organisation={row.organisation.name} />
            )}
            <div className="flex justify-end">
              <Button variant="primary" data-autofocus onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        );
      }}
    </WhenLoaded>
  );
}

export interface ScoresDialogProps {
  /** The submission to show, or null while the dialog is closed. */
  row: SpreadRow | null;
  onClose: () => void;
}

/** How each reviewer scored one submission at its stage, criterion by criterion. */
export function ScoresDialog({ row, onClose }: ScoresDialogProps) {
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      wide
      title={row === null ? 'Scores' : `Scores for ${row.organisation.name}`}
      description={
        row === null
          ? undefined
          : `Each reviewer's score for each criterion at ${row.stage.name}. Only staff see this.`
      }
    >
      {row !== null && <Scores key={row.submissionId} row={row} onClose={onClose} />}
    </Dialog>
  );
}
