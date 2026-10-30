// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileTypeLabels } from '@pixel-scientists/domain/files';
import { tableTotals, visibleFields } from '@pixel-scientists/domain/forms';
import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  AnswerView,
  Button,
  buttonClassName,
  EmptyState,
  Link,
  LoadingState,
  PageHeader,
  ShortcutsDialog,
  Tag,
  useLoad,
  useNavigate,
} from '@pixel-scientists/ui';
import type { AnswerHelpers, ShortcutGroup } from '@pixel-scientists/ui';
import { useEffect, useState } from 'react';

import type { Review } from '../../contracts/index.ts';
import { loadReview } from './loaders.ts';
import { useHeadingFocus } from '../forms/useHeadingFocus.ts';
import { ScorePage, useParam } from './Page.tsx';
import { REVIEWS_PATH } from './paths.ts';
import { ScorePanel } from './ScorePanel.tsx';
import { applicationName, reviewStateTones, reviewStateWords, reviewStateOf } from './words.ts';

const helpers: AnswerHelpers = { formatMoney, tableTotals, fileTypeLabels };

const shortcuts: readonly ShortcutGroup[] = [
  {
    title: 'In your review',
    shortcuts: [
      { keys: ['Alt', 'Arrow down'], does: 'Go to the next criterion' },
      { keys: ['Alt', 'Arrow up'], does: 'Go to the previous criterion' },
      { keys: ['Arrow left', 'Arrow right'], does: 'Change the score when a score has focus' },
      { keys: ['0 to 9'], does: 'Give the criterion that score when a score has focus' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
];

/** Whether a key press is typing into something, where "?" is a character and not a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && target.type !== 'radio' && target.type !== 'checkbox')
  );
}

function Workspace({ review }: { review: Review }) {
  useHeadingFocus();
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  const [status, setStatus] = useState(review.status);
  const state = reviewStateOf({ status, progress: review.progress });
  const { definition } = review.form;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.key !== '?' ||
        isTyping(event.target) ||
        document.querySelector('[role="dialog"]')
      ) {
        return;
      }
      event.preventDefault();
      setHelp(true);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const header = (
    <PageHeader
      breadcrumbs={[
        { label: 'My reviews', to: REVIEWS_PATH },
        { label: applicationName(review.applicationId) },
      ]}
      eyebrow={
        <span>
          Blind review, {review.programme.title}, {review.round.title}
        </span>
      }
      title={applicationName(review.applicationId)}
      description={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Tag tone={reviewStateTones[state]}>{reviewStateWords[state]}</Tag>
          <span>{review.stage.name}</span>
        </span>
      }
      actions={
        <>
          <a
            href="#review-heading"
            className={buttonClassName('quiet', 'no-underline')}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById('review-heading')?.focus();
            }}
          >
            Go to your review
          </a>
          <Button
            onClick={() => {
              setHelp(true);
            }}
          >
            Keyboard shortcuts
          </Button>
        </>
      }
    />
  );

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {header}
          <p className="max-w-prose rounded-lg border border-divider bg-sunken/60 p-4 text-body text-ink">
            <span className="font-semibold">Some answers are hidden from reviewers. </span>
            You are scoring the application, not the organisation. Names, contact details and
            anything that could identify the applicant are left out for every reviewer.
          </p>
          <AnswerView
            sections={definition.sections}
            visible={visibleFields(definition, review.answers)}
            answers={review.answers}
            helpers={helpers}
            headingLevel="h2"
          />
        </div>
        <ScorePanel
          review={review}
          onSubmitted={(summary) => {
            setStatus(summary.status);
          }}
          onNavigate={navigate}
        />
      </div>
      <ShortcutsDialog
        open={help}
        onOpenChange={setHelp}
        groups={shortcuts}
        description="Press Tab to reach a score, then use these keys."
      />
    </>
  );
}

function NotOnYourList() {
  useHeadingFocus();
  return (
    <>
      <PageHeader title="Review not found" />
      <EmptyState
        title="This review is not on your list"
        action={
          <Link to={REVIEWS_PATH} className={buttonClassName()}>
            Go to My reviews
          </Link>
        }
      >
        <p>It may be assigned to someone else, or you declared a conflict and it left your list.</p>
      </EmptyState>
    </>
  );
}

function Reviewing({ assignmentId }: { assignmentId: string }) {
  const { state, retry } = useLoad(loadReview, assignmentId);
  if (state.status === 'loading') {
    return (
      <>
        <PageHeader title="Your review" />
        <LoadingState label="Loading your review" className="rounded-lg bg-surface" />
      </>
    );
  }
  if (state.status === 'failed') {
    return (
      <>
        <PageHeader title="Your review" />
        <EmptyState
          title="We could not load this review"
          action={<Button onClick={retry}>Try again</Button>}
        >
          <p>{state.message}</p>
        </EmptyState>
      </>
    );
  }
  if (state.value === null) return <NotOnYourList />;
  return <Workspace review={state.value} />;
}

/** The scoring workspace: the application, answered blind, beside the rubric. */
export default function ReviewRoute() {
  const assignmentId = useParam('assignmentId');
  return (
    <ScorePage title="Review">
      <Reviewing key={assignmentId} assignmentId={assignmentId} />
    </ScorePage>
  );
}
