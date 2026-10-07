// SPDX-License-Identifier: AGPL-3.0-or-later

import { FormField, Tag, Textarea } from '@pixel-scientists/ui';

import type { Entry } from './blind.ts';
import { ScoreScale } from './ScoreScale.tsx';
import type { criteria } from '../story.ts';

type Criterion = (typeof criteria)[number];

/** The id of a criterion's first radio button, where an error summary or a "still to score" link lands. */
export const firstScoreId = (criterion: Criterion): string => `score-${criterion.id}-1`;

export const anchorId = (criterion: Criterion): string => `criterion-${criterion.id}`;

/**
 * Where a criterion stands, in words: scored, started (a comment but no score)
 * or not scored. After a failed submit, one with no score needs one.
 */
export function stateOf(
  entry: Entry,
  failed: boolean,
): { words: string; tone: 'success' | 'info' | 'neutral' | 'danger' } {
  if (entry.score !== null) return { words: 'Scored', tone: 'success' };
  if (failed) return { words: 'Needs a score', tone: 'danger' };
  if (entry.comment.trim() !== '') return { words: 'In progress', tone: 'info' };
  return { words: 'Not scored', tone: 'neutral' };
}

/** One criterion: its guidance, a 1 to 5 score, and an optional comment. */
export function CriterionScore({
  criterion,
  entry,
  failed,
  onChange,
}: {
  criterion: Criterion;
  entry: Entry;
  /** Whether the person has tried to submit without scoring every criterion. */
  failed: boolean;
  onChange: (entry: Entry) => void;
}) {
  const { words, tone } = stateOf(entry, failed);
  const nameId = `${criterion.id}-name`;
  const guidanceId = `${criterion.id}-guidance`;
  const errorId = `${criterion.id}-error`;
  const missing = failed && entry.score === null;
  return (
    <section
      id={anchorId(criterion)}
      aria-labelledby={nameId}
      className="flex scroll-mt-4 flex-col gap-2.5 border-t border-divider py-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id={nameId} className="text-body font-semibold text-ink">
          {criterion.label}
          <span className="ml-2 font-normal text-muted">
            <span className="sr-only">, </span>Weight {criterion.weight}
          </span>
        </h3>
        <Tag tone={tone}>{words}</Tag>
      </div>
      <p id={guidanceId} className="text-sm text-muted">
        {criterion.guidance}
      </p>
      <div className={missing ? 'flex flex-col gap-1.5 border-l-4 border-danger pl-3' : undefined}>
        {missing && (
          <p id={errorId} className="text-sm font-medium text-danger">
            <span className="sr-only">Error: </span>Give {criterion.label} a score from 1 to 5
          </p>
        )}
        <ScoreScale
          name={`score-${criterion.id}`}
          labelledBy={nameId}
          describedBy={missing ? `${guidanceId} ${errorId}` : guidanceId}
          idPrefix={`score-${criterion.id}`}
          value={entry.score}
          onChange={(score) => {
            onChange({ ...entry, score });
          }}
        />
      </div>
      <FormField
        optional
        label={
          <>
            Comment<span className="sr-only"> on {criterion.label}</span>
          </>
        }
      >
        <Textarea
          rows={2}
          value={entry.comment}
          onChange={(event) => {
            onChange({ ...entry, comment: event.currentTarget.value });
          }}
        />
      </FormField>
    </section>
  );
}
