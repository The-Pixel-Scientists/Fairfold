// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One form, one task at a time: a first screen, a screen for each section,
// a review and a confirmation. Signed-in respondents and anonymous ones
// answer through it; what differs is where answers are kept and how they are
// sent, which the page passes in. The engine's checks run here for speed and
// again on the server, which decides.

import { ProblemError } from '@pixel-scientists/domain/api';
import { canSee, validateAnswers, visibleFields } from '@pixel-scientists/domain/forms';
import type { Answers, FormDefinition } from '@pixel-scientists/domain/forms';
import {
  AnswerView,
  Button,
  FormSection,
  Notice,
  PageHeading,
  SectionProgress,
  useLeaveGuard,
} from '@pixel-scientists/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { helpers } from './helpers.ts';
import { failureOf, fieldProblemsOf, wordsFor } from './problems.ts';
import type { FieldProblem } from './problems.ts';

export interface Receipt {
  /** The funder's own thanks, or empty for ours. */
  message: string;
  /** What the person can quote to find their response. Shown once and kept nowhere. */
  reference?: string;
}

/** Where answers live while the person fills them in. */
export interface AnswerStore {
  answers: Answers;
  /** Called with a question's id and its new answer, or null when the person clears it. */
  change: (fieldId: string, value: unknown) => void;
  /** Says whether the answers are safe. */
  status: ReactNode;
  /** One sentence under the status on every screen. */
  note: string;
  /** Answers that would be lost if the person left now. */
  unsaved: boolean;
  /** Saves now. False when the answers could not be saved. */
  flush: () => Promise<boolean>;
}

export interface FormRunnerProps {
  title: string;
  description: string;
  definition: FormDefinition;
  store: AnswerStore;
  /** What to tell the person before the first question. */
  notices?: ReactNode;
  /** Under every screen but the last, such as "Clear my answers". */
  footer?: ReactNode;
  /** Sends the answers. Throws a ProblemError when they are refused. */
  submit: (answers: Answers) => Promise<Receipt>;
  /** Called when the server says the form changed, with what the person has so far. */
  onFormChanged?: (answers: Answers) => void;
  /** True while the page waits on something before it can send, such as the browser check. */
  waiting?: boolean;
  /** Shown beside the button while it waits. */
  waitingNote?: string;
  /** Opens on the review with this said first, as after a form changed under the person. */
  reviewNote?: string;
}

type Step =
  | { name: 'intro' }
  | { name: 'section'; index: number }
  | { name: 'review' }
  | { name: 'sent'; receipt: Receipt };

/** The id of the control a problem is about, as FormSection names it. */
function controlId(field: string): string {
  const [id = field, ...parts] = field.split('.');
  return parts.length === 0 || parts[0] === 'line1' ? id : `${id}-${parts.join('-')}`;
}

const questionOf = (field: string) => field.split('.')[0] ?? field;

export function FormRunner({
  title,
  description,
  definition,
  store,
  notices,
  footer,
  submit,
  onFormChanged,
  waiting = false,
  waitingNote = '',
  reviewNote,
}: FormRunnerProps) {
  const { answers } = store;
  const [step, setStep] = useState<Step>(
    reviewNote !== undefined ? { name: 'review' } : { name: 'intro' },
  );
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [refused, setRefused] = useState<readonly FieldProblem[]>([]);
  const sending = useRef(false);
  const top = useRef<HTMLDivElement>(null);
  const goTo = useRef<string | null>(null);

  const shown = useMemo(
    () => visibleFields(definition, answers).filter((field) => canSee(field, 'respondent')),
    [definition, answers],
  );
  const ids = new Set(shown.map((field) => field.id));
  const sections = definition.sections.filter((section) =>
    section.fields.some((field) => ids.has(field.id)),
  );
  const labelOf = (id: string): string => {
    const field = sections.flatMap((section) => section.fields).find((item) => item.id === id);
    return field !== undefined && 'label' in field ? `${field.label}: ` : '';
  };
  const sectionOf = (id: string) =>
    sections.findIndex((section) => section.fields.some((field) => field.id === id));

  useLeaveGuard(
    store.unsaved,
    'Some of your answers are not saved. If you leave this page, you may lose them.',
  );

  const stepKey = step.name === 'section' ? `section-${String(step.index)}` : step.name;
  useEffect(() => {
    const target = goTo.current === null ? null : document.getElementById(goTo.current);
    goTo.current = null;
    (target ?? top.current?.querySelector<HTMLElement>('h1'))?.focus();
  }, [stepKey]);

  /** What the server reads: answers to shown questions only. */
  const sendable = (): Answers => {
    const visible = new Set(visibleFields(definition, answers).map(({ id }) => id));
    return Object.fromEntries(Object.entries(answers).filter(([id]) => visible.has(id)));
  };
  const local = (mode: 'draft' | 'submit') => validateAnswers(definition, sendable(), mode);
  const reviewProblems: FieldProblem[] = [...local('submit'), ...refused].filter(
    (problem, index, all) =>
      ids.has(questionOf(problem.field)) &&
      all.findIndex((other) => other.field === problem.field) === index,
  );

  async function moveTo(next: Step) {
    setFailure(null);
    if (!(await store.flush())) {
      setFailure('We could not save your answers. Check your connection and try again.');
      return;
    }
    setAttempt(0);
    setStep(next);
  }

  async function send() {
    if (sending.current) return;
    if (reviewProblems.length > 0) {
      setAttempt((count) => count + 1);
      return;
    }
    sending.current = true;
    setPending(true);
    setFailure(null);
    try {
      setStep({ name: 'sent', receipt: await submit(sendable()) });
    } catch (error) {
      if (error instanceof ProblemError && failureOf(error) === 'form_changed') {
        onFormChanged?.(answers);
        return;
      }
      setRefused(fieldProblemsOf(error));
      setAttempt((count) => count + 1);
      setFailure(wordsFor(error));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  const save = (
    <div className="flex flex-col items-start gap-1">
      {store.status}
      <p className="text-sm text-muted">{store.note}</p>
    </div>
  );
  const problem =
    failure === null ? null : (
      <p role="alert" className="max-w-prose text-body font-medium text-danger">
        {failure}
      </p>
    );

  let screen: ReactNode = null;
  if (step.name === 'intro') {
    screen = (
      <>
        <PageHeading className="text-3xl sm:text-4xl">{title}</PageHeading>
        {description !== '' && (
          <p className="max-w-prose whitespace-pre-line text-lg text-ink">{description}</p>
        )}
        {notices}
        <div>
          <Button
            variant="primary"
            className="w-full sm:w-auto"
            onClick={() => {
              setStep(sections.length === 0 ? { name: 'review' } : { name: 'section', index: 0 });
            }}
          >
            {Object.keys(answers).length > 0 ? 'Continue my answers' : 'Start'}
          </Button>
        </div>
      </>
    );
  } else if (step.name === 'section' && sections[step.index] !== undefined) {
    const { index } = step;
    const section = sections[index];
    const last = index === sections.length - 1;
    const inSection = new Set(section?.fields.map((field) => field.id));
    const found = local('draft').filter((item) => inSection.has(questionOf(item.field)));
    const aggregate = section?.fields.some(
      (field) =>
        ids.has(field.id) && field.type !== 'content' && field.audiences === 'aggregate_only',
    );
    screen = section && (
      <form
        noValidate
        className="flex flex-col gap-10"
        onSubmit={(event) => {
          event.preventDefault();
          if (found.length > 0) setAttempt((count) => count + 1);
          else void moveTo(last ? { name: 'review' } : { name: 'section', index: index + 1 });
        }}
      >
        <SectionProgress current={index + 1} total={sections.length} />
        {aggregate === true && (
          <p className="max-w-prose text-body text-muted">
            Only totals are seen for some of these questions, never your own answer.
          </p>
        )}
        <FormSection
          section={section}
          visible={shown}
          answers={answers}
          problems={attempt > 0 ? found : []}
          attempt={attempt}
          helpers={helpers}
          headingLevel="h1"
          onChange={store.change}
        />
        {problem}
        <div className="flex flex-col gap-5 border-t border-divider pt-6">
          {save}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" variant="primary" className="w-full sm:w-auto">
              {last ? 'Save and check your answers' : 'Save and continue'}
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                void moveTo(
                  index === 0 ? { name: 'intro' } : { name: 'section', index: index - 1 },
                );
              }}
            >
              Back
            </Button>
          </div>
        </div>
      </form>
    );
  } else if (step.name === 'review') {
    screen = (
      <>
        <PageHeading className="text-3xl sm:text-4xl">Check your answers</PageHeading>
        {reviewNote !== undefined && <p className="max-w-prose text-body text-ink">{reviewNote}</p>}
        {reviewProblems.length > 0 && (
          <div
            key={attempt}
            role={attempt > 0 ? 'alert' : undefined}
            tabIndex={-1}
            ref={(element) => {
              if (attempt > 0) element?.focus();
            }}
          >
            <Notice
              tone="warning"
              title={
                reviewProblems.length === 1
                  ? 'One question needs your attention'
                  : `${String(reviewProblems.length)} questions need your attention`
              }
            >
              <ul role="list" className="mt-2 flex flex-col gap-3">
                {reviewProblems.map((item) => (
                  <li key={item.field} className="flex flex-col items-start gap-1">
                    <span className="text-body text-ink">
                      {labelOf(questionOf(item.field))}
                      {item.message}
                    </span>
                    <Button
                      onClick={() => {
                        goTo.current = controlId(item.field);
                        setStep({
                          name: 'section',
                          index: Math.max(sectionOf(questionOf(item.field)), 0),
                        });
                      }}
                    >
                      Go to this question
                    </Button>
                  </li>
                ))}
              </ul>
            </Notice>
          </div>
        )}
        <AnswerView
          sections={sections}
          visible={shown}
          answers={answers}
          helpers={helpers}
          headingLevel="h2"
        />
        {problem}
        <div className="flex flex-col gap-5 border-t border-divider pt-6">
          {save}
          <p role="status" className="text-body text-muted">
            {pending && waiting ? waitingNote : ''}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="primary"
              aria-disabled={pending || undefined}
              className="w-full sm:w-auto"
              onClick={() => {
                void send();
              }}
            >
              {failure === null ? 'Send my answers' : 'Try again'}
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                setStep(
                  sections.length === 0
                    ? { name: 'intro' }
                    : { name: 'section', index: sections.length - 1 },
                );
              }}
            >
              Back
            </Button>
          </div>
        </div>
      </>
    );
  } else if (step.name === 'sent') {
    const { receipt } = step;
    screen = (
      <>
        <PageHeading className="text-3xl sm:text-4xl">Your answers have been sent</PageHeading>
        <p className="max-w-prose whitespace-pre-line text-lg text-ink">
          {receipt.message === '' ? 'Thank you. We have your answers.' : receipt.message}
        </p>
        {receipt.reference !== undefined && <Reference reference={receipt.reference} />}
      </>
    );
  }

  return (
    <div ref={top} className="flex max-w-prose flex-col gap-8">
      {screen}
      {step.name !== 'sent' && footer}
    </div>
  );
}

/** The reference the person can quote to the funder. It is on this screen only. */
function Reference({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-divider bg-surface p-5">
      <h2 className="text-lg font-semibold text-ink">Your reference</h2>
      <p className="text-body text-ink">
        Keep this reference. If you ask the funder to find or remove your answers, quote it. We do
        not keep a copy of it, so we cannot find it again for you.
      </p>
      <code className="text-body break-all text-ink">{reference}</code>
      <Button
        onClick={() => {
          navigator.clipboard.writeText(reference).then(
            () => {
              setCopied(true);
            },
            () => {
              setCopied(false);
            },
          );
        }}
      >
        Copy reference
      </Button>
      <p role="status" className="text-body text-muted">
        {copied ? 'Reference copied.' : ''}
      </p>
    </div>
  );
}
