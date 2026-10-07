// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: the scoring workspace. The blind answers are on the left
// and the five weighted criteria on the right, in a column that stays in view
// inside its own column and never over the answers.

import {
  Button,
  Dialog,
  ErrorSummary,
  FormField,
  Link,
  Meter,
  PageHeader,
  SaveStatus,
  Tag,
  Textarea,
  buttonClassName,
} from '@pixel-scientists/ui';
import type { SaveState } from '@pixel-scientists/ui';
import { Fragment, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { AnswerSection, BudgetTable } from './ApplicationParts.tsx';
import {
  answers,
  budget,
  otherFunding,
  project,
  reference,
  requested,
  reviewerForm,
  startingEntries,
} from './blind.ts';
import type { Entry } from './blind.ts';
import { CriterionScore, anchorId, firstScoreId } from './CriterionScore.tsx';
import { CheckIcon, EyeOffIcon } from './icons.tsx';
import { Notice } from './Notice.tsx';
import { criteria, moments, pounds } from '../story.ts';

type Phase = 'scoring' | 'submitted' | 'conflict';

export default function Scoring() {
  const [entries, setEntries] = useState<Readonly<Record<string, Entry>>>(startingEntries);
  const [save, setSave] = useState<SaveState>({ status: 'saved', at: moments.assessing });
  const [phase, setPhase] = useState<Phase>('scoring');
  const [attempts, setAttempts] = useState(0);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (phase === 'submitted') confirmation.current?.focus();
  }, [phase]);

  const scored = criteria.filter((criterion) => (entries[criterion.id]?.score ?? null) !== null);
  const unscored = criteria.filter((criterion) => (entries[criterion.id]?.score ?? null) === null);
  const weightScored = scored.reduce((sum, criterion) => sum + criterion.weight, 0);
  const points = scored.reduce(
    (sum, criterion) => sum + criterion.weight * (entries[criterion.id]?.score ?? 0),
    0,
  );
  const total = weightScored === 0 ? 0 : Math.round((points / weightScored) * 10) / 10;

  function change(id: string, entry: Entry) {
    setEntries({ ...entries, [id]: entry });
    setSave({ status: 'saved', at: moments.assessing });
  }

  function submit() {
    if (unscored.length > 0) setAttempts(attempts + 1);
    else setPhase('submitted');
  }

  function declare() {
    if (reason.trim() === '') {
      setReasonError(true);
      reasonInput.current?.focus();
      return;
    }
    setAsking(false);
    setPhase('conflict');
  }

  function goTo(id: string) {
    document.getElementById(id)?.focus();
  }

  const status =
    phase === 'conflict' ? (
      <Tag tone="warning">Conflict declared</Tag>
    ) : phase === 'submitted' ? (
      <Tag tone="success">Submitted</Tag>
    ) : (
      <Tag tone="info">In progress</Tag>
    );

  const header = (
    <PageHeader
      breadcrumbs={[{ label: 'My reviews', to: '/reviews' }, { label: reference }]}
      eyebrow={
        <>
          <Tag tone="info">Design preview</Tag>
          <span>Blind review, Community Grants, Spring 2027</span>
        </>
      }
      title={project}
      description={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {status}
          <span className="tabular-nums">{reference}</span>
          <span>Requested {pounds(requested)}</span>
          <span>Review due 24 March 2027</span>
        </span>
      }
    />
  );

  if (phase === 'conflict') {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Notice
          tone="warning"
          icon={<EyeOffIcon />}
          title="You declared a conflict, so this application has left your list"
        >
          <p>
            Staff have your reason and will give the application to another reviewer. You can no
            longer see it, and nothing you entered counts towards its score.
          </p>
          <p>
            <Link to="/reviews">Go back to My reviews</Link>
          </p>
        </Notice>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          {header}
          <Notice
            tone="neutral"
            icon={<EyeOffIcon />}
            title="Some answers are hidden from reviewers"
          >
            <p>
              You are scoring the application, not the organisation. Names, contact details and any
              checks staff make on the organisation are left out for every reviewer.
            </p>
          </Notice>
          {reviewerForm.sections.map((section) => (
            <Fragment key={section.id}>
              <AnswerSection section={section} answers={answers} />
              {section.id === 'project' && (
                <BudgetTable lines={budget} otherFunding={otherFunding} />
              )}
            </Fragment>
          ))}
        </div>

        <section
          aria-labelledby="review-heading"
          className="flex flex-col rounded-lg border border-divider bg-surface shadow-(--shadow-raised) xl:sticky xl:top-4 xl:max-h-[calc(100dvh-8rem)]"
        >
          <div className="flex flex-col gap-1 px-gutter pt-gutter pb-3">
            <h2
              id="review-heading"
              tabIndex={-1}
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Your review
            </h2>
            <p className="text-sm text-muted">
              Score each criterion from 1 to 5. Your work saves as you go.
            </p>
          </div>

          <div className="flex min-h-0 flex-col gap-4 border-t border-divider px-gutter pt-4 pb-2 xl:overflow-y-auto xl:pb-6 xl:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]">
            {phase === 'submitted' ? (
              <p
                ref={confirmation}
                tabIndex={-1}
                role="status"
                className="flex gap-2 pb-2 text-body text-ink"
              >
                <CheckIcon className="mt-0.5 text-success" />
                <span>
                  <span className="font-semibold">Your review is submitted. </span>
                  You can change it until reviews close on 24 March 2027. Staff see your scores and
                  comments; the applicant never does.
                </span>
              </p>
            ) : (
              <>
                <ErrorSummary
                  key={attempts}
                  errors={
                    attempts === 0
                      ? []
                      : unscored.map((criterion) => ({
                          fieldId: firstScoreId(criterion),
                          message: `Give ${criterion.label} a score from 1 to 5`,
                        }))
                  }
                  title="Score every criterion to submit"
                />
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
              </>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-divider px-gutter py-4">
            <Meter
              label={
                unscored.length === 0
                  ? 'Your weighted total'
                  : `Weighted total so far (${String(scored.length)} of ${String(criteria.length)} scored)`
              }
              value={total}
              max={5}
              valueText={`${total.toFixed(1)} of 5`}
            />
            {phase === 'scoring' &&
              (unscored.length > 0 ? (
                <p className="text-body">
                  <span className="font-medium text-ink">Still to score: </span>
                  {unscored.map((criterion, index) => (
                    <span key={criterion.id}>
                      {index > 0 && (index === unscored.length - 1 ? ' and ' : ', ')}
                      <a
                        href={`#${anchorId(criterion)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          goTo(firstScoreId(criterion));
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
            <SaveStatus state={save} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {phase === 'scoring' ? (
                <>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setReason('');
                      setReasonError(false);
                      setAsking(true);
                    }}
                  >
                    Declare a conflict
                  </Button>
                  <Button variant="primary" onClick={submit}>
                    Submit review
                  </Button>
                </>
              ) : (
                <>
                  <Link to="/reviews" className={buttonClassName('quiet', 'no-underline')}>
                    Back to My reviews
                  </Link>
                  <Button
                    onClick={() => {
                      flushSync(() => {
                        setPhase('scoring');
                      });
                      document.getElementById('review-heading')?.focus();
                    }}
                  >
                    Change my review
                  </Button>
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title="Declare a conflict of interest"
        description="If you know the applicant or have a stake in this project, you should not score it. It leaves your list and goes to another reviewer."
        actions={
          <>
            <Button
              onClick={() => {
                setAsking(false);
              }}
            >
              Keep reviewing
            </Button>
            <Button variant="primary" onClick={declare}>
              Declare a conflict
            </Button>
          </>
        }
      >
        <FormField
          label="Why do you have a conflict?"
          hint="Staff see your reason. Applicants and other reviewers never do."
          error={reasonError ? 'Tell staff why you are declaring a conflict' : undefined}
        >
          <Textarea
            ref={reasonInput}
            data-autofocus
            rows={3}
            value={reason}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
        </FormField>
      </Dialog>
    </>
  );
}
