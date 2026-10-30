// SPDX-License-Identifier: AGPL-3.0-or-later

import { FormField, Tag, Textarea } from '@pixel-scientists/ui';
import type { TagTone } from '@pixel-scientists/ui';

import type { Criterion } from '../../contracts/index.ts';
import { ScoreScale } from './ScoreScale.tsx';
import { scaleWords } from './scoring.ts';
import type { Entry } from './scoring.ts';

/** The most a comment holds, as the server checks. */
const COMMENT_LENGTH = 2000;

export const anchorId = (criterion: Criterion): string => `criterion-${criterion.id}`;

/** Where a criterion stands, in words. After a failed submit, one with no score needs one. */
function stateOf(entry: Entry, failed: boolean): { words: string; tone: TagTone } {
  if (entry.score !== null) return { words: 'Scored', tone: 'success' };
  return failed
    ? { words: 'Needs a score', tone: 'danger' }
    : { words: 'Not scored', tone: 'neutral' };
}

export interface CriterionScoreProps {
  criterion: Criterion;
  entry: Entry;
  /** Whether the reviewer has tried to submit without scoring every criterion. */
  failed: boolean;
  onChange: (entry: Entry) => void;
}

/** One criterion: its guidance, its scale, and an optional comment. */
export function CriterionScore({ criterion, entry, failed, onChange }: CriterionScoreProps) {
  const { words, tone } = stateOf(entry, failed);
  const nameId = `${criterion.id}-name`;
  const guidanceId = `${criterion.id}-guidance`;
  const errorId = `${criterion.id}-error`;
  const missing = failed && entry.score === null;
  return (
    <section
      id={anchorId(criterion)}
      data-criterion={criterion.id}
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
        {criterion.guidance === '' ? '' : `${criterion.guidance} `}
        {scaleWords(criterion)}.
      </p>
      <div className={missing ? 'flex flex-col gap-1.5 border-l-4 border-danger pl-3' : undefined}>
        {missing && (
          <p id={errorId} className="text-sm font-medium text-danger">
            <span className="sr-only">Error: </span>
            Give {criterion.label} a score from {criterion.scaleMin} to {criterion.scaleMax}
          </p>
        )}
        <ScoreScale
          criterion={criterion}
          labelledBy={nameId}
          describedBy={missing ? `${guidanceId} ${errorId}` : guidanceId}
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
        hint={
          entry.score === null && entry.comment !== '' ? 'Saved once you give a score.' : undefined
        }
      >
        <Textarea
          rows={2}
          maxLength={COMMENT_LENGTH}
          value={entry.comment}
          onChange={(event) => {
            onChange({ ...entry, comment: event.currentTarget.value });
          }}
        />
      </FormField>
    </section>
  );
}
