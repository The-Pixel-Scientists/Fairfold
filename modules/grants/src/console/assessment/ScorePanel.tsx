// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  buttonClassName,
  ErrorSummary,
  Link,
  Meter,
  SaveStatus,
  useLeaveGuard,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import type { Review, ReviewSummary } from '../../contracts/index.ts';
import { formatMoment } from '../programme/format.ts';
import { ConflictDialog } from './ConflictDialog.tsx';
import { anchorId, CriterionScore } from './CriterionScore.tsx';
import { submitScores } from './loaders.ts';
import { CONFLICT_DECLARED_PATH, REVIEWS_PATH } from './paths.ts';
import { problemLines } from './problems.ts';
import { firstScoreId, scoreId } from './ScoreScale.tsx';
import { scaleOf, startingEntries, toInput, unscored, weightedTotal } from './scoring.ts';
import { useReviewScores } from './useReviewScores.ts';
import { formatScore } from './words.ts';

type Phase = 'check' | 'scoring' | 'submitted';

const phaseOf = (review: Review): Phase =>
  review.status === 'submitted' ? 'submitted' : review.scores.length === 0 ? 'check' : 'scoring';

const HEADING_ID = 'review-heading';

/** Moves focus to a criterion's score: the one chosen, or the first. */
function focusScore(section: Element | undefined): void {
  const radios = section?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  const target = [...(radios ?? [])].find((radio) => radio.checked) ?? radios?.[0];
  target?.focus();
}

export interface ScorePanelProps {
  review: Review;
  /** Called with the server's summary once the review is submitted. */
  onSubmitted: (summary: ReviewSummary) => void;
  onNavigate: (path: string) => void;
}

/**
 * The reviewer's side of the workspace: a check for a conflict before any
 * scoring, then each criterion with its scale and comment, saved as they go,
 * then the submitted review. Keys: Alt with the up or down arrow moves to the
 * previous or next criterion, and a number key gives the focused criterion
 * that score.
 */
export function ScorePanel({ review, onSubmitted, onNavigate }: ScorePanelProps) {
  const { criteria } = review;
  const [phase, setPhase] = useState(phaseOf(review));
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<readonly string[]>([]);
  const [submittedAt, setSubmittedAt] = useState(review.submittedAt);
  const root = useRef<HTMLElement>(null);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const started = useRef(false);
  const { entries, save, unsaved, change, saveNow } = useReviewScores(
    review.id,
    criteria,
    startingEntries(criteria, review.scores),
  );

  useLeaveGuard(unsaved && phase === 'scoring' && !leaving);

  const missing = unscored(criteria, entries);
  const total = weightedTotal(criteria, entries);
  const scale = scaleOf(criteria);
  const editing = phase === 'scoring';

  useEffect(() => {
    // Only a review submitted just now moves focus: one opened already submitted starts at the top of the page.
    if (phase === 'submitted' && review.status !== 'submitted') confirmation.current?.focus();
  }, [phase, review.status]);

  useEffect(() => {
    // A review the reviewer has just started takes focus on its heading.
    if (phase === 'scoring' && started.current) {
      started.current = false;
      document.getElementById(HEADING_ID)?.focus();
    }
  }, [phase]);

  // Leaving waits for the page to stop guarding against unsaved changes: they are discarded by the conflict.
  useEffect(() => {
    if (leaving) onNavigate(CONFLICT_DECLARED_PATH);
  }, [leaving, onNavigate]);

  function begin() {
    started.current = true;
    setPhase('scoring');
  }

  async function submit() {
    if (submitting) return;
    if (missing.length > 0) {
      setAttempts(attempts + 1);
      return;
    }
    setSubmitting(true);
    setFailure([]);
    await saveNow();
    try {
      const summary = await submitScores(review.id, toInput(criteria, entries));
      setSubmittedAt(summary.submittedAt);
      setPhase('submitted');
      onSubmitted(summary);
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setSubmitting(false);
    }
  }

  // The keys are heard on the panel as a whole, so they work from any score or comment inside it.
  useEffect(() => {
    const panel = root.current;
    if (panel === null || !editing) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const sections = [...panel.querySelectorAll('[data-criterion]')];
        const here = sections.findIndex((section) => section.contains(target));
        const step = event.key === 'ArrowDown' ? 1 : -1;
        focusScore(sections[Math.min(Math.max(here + step, 0), sections.length - 1)]);
        return;
      }
      if (
        target instanceof HTMLInputElement &&
        target.type === 'radio' &&
        /^\d$/.test(event.key) &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const criterion = criteria.find(({ id }) => `score-${id}` === target.name);
        const score = Number(event.key);
        if (!criterion || score < criterion.scaleMin || score > criterion.scaleMax) return;
        event.preventDefault();
        change(criterion.id, { ...(entries[criterion.id] ?? { comment: '' }), score });
        document.getElementById(scoreId(criterion, score))?.focus();
      }
    };
    panel.addEventListener('keydown', onKeyDown);
    return () => {
      panel.removeEventListener('keydown', onKeyDown);
    };
  }, [editing, criteria, entries, change]);

  const subtitle =
    phase === 'check'
      ? 'Before you score, check that you have no conflict of interest with this application.'
      : phase === 'submitted'
        ? 'Staff see your scores and comments. The applicant never does.'
        : `Score each criterion from ${String(scale.min)} to ${String(scale.max)}. Your work saves as you go.`;

  return (
    <section
      ref={root}
      aria-labelledby={HEADING_ID}
      className="flex flex-col rounded-lg border border-divider bg-surface shadow-(--shadow-raised) xl:sticky xl:top-4 xl:max-h-[calc(100dvh-8rem)]"
    >
      <div className="flex flex-col gap-1 px-gutter pt-gutter pb-3">
        <h2 id={HEADING_ID} tabIndex={-1} className="text-lg font-semibold tracking-tight text-ink">
          Your review
        </h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>

      {phase === 'check' && (
        <div className="flex flex-col gap-4 border-t border-divider px-gutter py-4">
          <p className="text-body text-ink">
            You are scoring the application, not the organisation. If you recognise the project or
            have a stake in it, declare a conflict. Either choice is fine.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={begin}>I have no conflict, start scoring</Button>
            <Button
              onClick={() => {
                setAsking(true);
              }}
            >
              Declare a conflict
            </Button>
          </div>
        </div>
      )}

      {phase === 'submitted' && (
        <div className="flex flex-col gap-4 border-t border-divider px-gutter py-4">
          <p
            ref={confirmation}
            role="status"
            tabIndex={-1}
            className="flex gap-2 text-body text-ink"
          >
            <span className="font-semibold">
              Your review is submitted
              {submittedAt === null ? '.' : ` on ${formatMoment(submittedAt)}.`}
            </span>
          </p>
          <dl className="flex flex-col divide-y divide-divider">
            {criteria.map((criterion) => {
              const entry = entries[criterion.id];
              return (
                <div key={criterion.id} className="flex flex-col gap-0.5 py-2 first:pt-0">
                  <dt className="flex flex-wrap items-baseline justify-between gap-2 text-body font-medium text-ink">
                    {criterion.label}
                    <span className="tabular-nums">
                      {entry?.score ?? 0} of {criterion.scaleMax}
                    </span>
                  </dt>
                  {entry?.comment ? (
                    <dd className="text-body whitespace-pre-line text-muted">{entry.comment}</dd>
                  ) : null}
                </div>
              );
            })}
          </dl>
        </div>
      )}

      {editing && (
        <div className="flex min-h-0 flex-col gap-4 border-t border-divider px-gutter pt-4 pb-2 xl:overflow-y-auto xl:pb-6">
          <ErrorSummary
            key={attempts}
            errors={
              attempts === 0
                ? []
                : missing.map((criterion) => ({
                    fieldId: firstScoreId(criterion),
                    message: `Give ${criterion.label} a score from ${String(criterion.scaleMin)} to ${String(criterion.scaleMax)}`,
                  }))
            }
            title="Score every criterion to submit"
          />
          {failure.length > 0 && (
            <div role="alert" className="rounded-md border-2 border-danger bg-danger-soft p-3">
              <ul className="flex list-disc flex-col gap-1 pl-4 text-body text-danger">
                {failure.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            {criteria.map((criterion) => (
              <CriterionScore
                key={criterion.id}
                criterion={criterion}
                entry={entries[criterion.id] ?? { score: null, comment: '' }}
                failed={attempts > 0}
                onChange={(entry) => {
                  change(criterion.id, entry);
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-divider px-gutter py-4">
        {phase !== 'check' && (
          <Meter
            label={
              missing.length === 0
                ? 'Your weighted total'
                : `Weighted total so far (${String(criteria.length - missing.length)} of ${String(criteria.length)} scored)`
            }
            value={total ?? scale.min}
            min={scale.min}
            max={scale.max}
            valueText={
              total === null
                ? 'Nothing scored yet'
                : `${formatScore(total)} of ${String(scale.max)}`
            }
          />
        )}
        {editing &&
          (missing.length > 0 ? (
            <p className="text-body">
              <span className="font-medium text-ink">Still to score: </span>
              {missing.map((criterion, index) => (
                <span key={criterion.id}>
                  {index > 0 && (index === missing.length - 1 ? ' and ' : ', ')}
                  <a
                    href={`#${anchorId(criterion)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(firstScoreId(criterion))?.focus();
                    }}
                  >
                    {criterion.label}
                  </a>
                </span>
              ))}
            </p>
          ) : (
            <p className="text-body font-medium text-success">
              Every criterion has a score. You can submit your review.
            </p>
          ))}
        {editing && (
          <div className="flex flex-wrap items-center gap-x-3">
            <SaveStatus state={save} />
            {save.status === 'failed' && (
              <Button
                variant="quiet"
                onClick={() => {
                  void saveNow();
                }}
              >
                Try saving again
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {editing ? (
            <>
              <Button
                variant="quiet"
                onClick={() => {
                  setAsking(true);
                }}
              >
                Declare a conflict
              </Button>
              <Button
                variant="primary"
                aria-disabled={submitting || undefined}
                onClick={() => {
                  void submit();
                }}
              >
                Submit review
              </Button>
            </>
          ) : (
            <Link to={REVIEWS_PATH} className={buttonClassName('quiet', 'no-underline')}>
              Back to My reviews
            </Link>
          )}
        </div>
      </div>

      <ConflictDialog
        open={asking}
        onOpenChange={setAsking}
        assignmentId={review.id}
        onDeclared={() => {
          setLeaving(true);
        }}
      />
    </section>
  );
}
