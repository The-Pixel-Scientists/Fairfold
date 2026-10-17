// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One screen of questions: the eligibility questions, or one section of the
// form. Answers save as they change and when the person leaves, and say so.
// "Save and continue" never blocks on a question left empty, since the check
// page lists those, but it does not move on from an answer that cannot be saved.

import { checkEligibility, visibleFields } from '@pixel-scientists/domain/forms';
import { checkApplicationEligibility } from '@pixel-scientists/grants/contracts';
import type { Application, Eligibility } from '@pixel-scientists/grants/contracts';
import {
  Breadcrumbs,
  Button,
  EligibilityStop,
  FormSection,
  SaveStatus,
  SectionProgress,
  useLeaveGuard,
  useNavigate,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../api.ts';
import { applicationPath, checkPath, sectionPath } from '../paths.ts';
import { ELIGIBILITY_SCREEN, problemsOf, questionOf, shownScreens } from './form.ts';
import type { Screen } from './form.ts';
import { helpers } from './helpers.ts';
import { PageTitle, useArrivalFocus } from './parts.tsx';
import { useAutosave } from './useAutosave.ts';
import { crumbs } from './views.tsx';

export interface QuestionsScreenProps {
  application: Application;
  screen: Screen;
  /** Reads the application again, to show the latest saved answers. */
  reload: () => void;
}

type Stopped = Extract<Eligibility, { status: 'stopped' }>;

export function QuestionsScreen({ application, screen, reload }: QuestionsScreenProps) {
  const navigate = useNavigate();
  const autosave = useAutosave(application);
  const { definition } = application.form;
  const { answers } = autosave;
  const eligibility = screen.id === ELIGIBILITY_SCREEN;
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refused, setRefused] = useState<Stopped | null>(null);
  useArrivalFocus();

  const unsaved = autosave.stale || autosave.held.length > 0 || autosave.status.status === 'failed';
  useLeaveGuard(
    unsaved,
    'Some of your answers are not saved. If you leave this page, you may lose them.',
  );

  const ids = new Set(screen.fields.map(({ id }) => id));
  const mode = eligibility ? 'submit' : 'draft';
  const found = () =>
    problemsOf(definition, answers, mode).filter((problem) => ids.has(questionOf(problem)));
  const result = eligibility ? checkEligibility(definition, answers) : null;
  const stop = result?.status === 'stopped' ? result : refused;

  /** Saves, then goes on. Moving on to the next screen also needs answers that can be saved. */
  async function carryOn(to: string, moveOn: boolean) {
    if (pending) return;
    if (moveOn && found().length > 0) {
      setAttempt((count) => count + 1);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      if (!(await autosave.save())) return;
      if (moveOn && eligibility) {
        const checked = await callApi(checkApplicationEligibility, {
          params: { applicationId: application.id },
        });
        if (checked.status === 'stopped') {
          setRefused(checked);
          return;
        }
        if (checked.status === 'incomplete') {
          setMessage('Answer every question on this page, then try again.');
          return;
        }
      }
      navigate(to);
    } catch {
      setMessage('We could not check your answers. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  // Where "Save and continue" goes depends on the answers, which can show or hide the sections after this one.
  const sections = shownScreens(definition, answers).filter(({ id }) => id !== ELIGIBILITY_SCREEN);
  const at = sections.findIndex(({ id }) => id === screen.id);
  const following = sections[at + 1];
  const step = eligibility ? undefined : { current: Math.max(at, 0) + 1, total: sections.length };
  let next = { to: applicationPath(application.id), label: 'Save and continue' };
  if (!eligibility) {
    next =
      following === undefined
        ? { to: checkPath(application.id), label: 'Save and check your answers' }
        : { ...next, to: sectionPath(application.id, following.id) };
  }

  return (
    <>
      <PageTitle
        title={
          step
            ? `Section ${String(step.current)} of ${String(step.total)}: ${screen.title}`
            : screen.title
        }
      />
      <div className="flex flex-col gap-5">
        <Breadcrumbs items={crumbs(application, screen.title)} />
        {step && <SectionProgress current={step.current} total={step.total} />}
      </div>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void carryOn(next.to, true);
        }}
        className="flex flex-col gap-10"
      >
        {autosave.restored && (
          <p className="max-w-prose rounded-md border border-divider bg-accent-soft p-4 text-body text-ink">
            We kept what you typed last time. We are saving it now.
          </p>
        )}
        <FormSection
          section={screen}
          visible={visibleFields(definition, answers)}
          answers={answers}
          problems={attempt > 0 ? found() : []}
          attempt={attempt}
          helpers={helpers}
          headingLevel="h1"
          onChange={(fieldId, value) => {
            setRefused(null);
            autosave.change(fieldId, value);
          }}
        />

        {stop && <EligibilityStop explanation={stop.explanation} fieldId={stop.fieldId} />}

        {autosave.stale && (
          <div
            role="alert"
            className="flex max-w-prose flex-col items-start gap-3 rounded-md border-2 border-warning bg-warning-soft p-4"
          >
            <h2 className="text-lg font-semibold text-ink">
              Your answers were saved somewhere else
            </h2>
            <p className="text-body text-ink">
              You may have this application open in another window or on another device. We have not
              saved what you typed here.
            </p>
            <p className="text-body text-ink">
              Show the latest saved answers to carry on. What you typed since then is replaced.
            </p>
            <Button
              variant="primary"
              onClick={() => {
                autosave.forget();
                reload();
              }}
            >
              Show the latest saved answers
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-5 border-t border-divider pt-6">
          <div className="flex flex-col items-start gap-1">
            <SaveStatus state={autosave.status} />
            {autosave.status.status === 'failed' && (
              <Button
                onClick={() => {
                  void autosave.save();
                }}
              >
                Try saving again
              </Button>
            )}
            {autosave.held.length > 0 && (
              <p className="text-body font-medium text-danger">
                Some answers are not saved yet. Fix them to save them.
              </p>
            )}
            <p className="text-sm text-muted">
              We save your answers as you type. You can leave at any time.
            </p>
          </div>
          {message && (
            <p role="alert" className="max-w-prose text-body font-medium text-danger">
              {message}
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            {stop === null && (
              <Button
                type="submit"
                variant="primary"
                aria-disabled={pending || undefined}
                className="w-full sm:w-auto"
              >
                {next.label}
              </Button>
            )}
            <Button
              aria-disabled={pending || undefined}
              className="w-full sm:w-auto"
              onClick={() => {
                void carryOn(applicationPath(application.id), false);
              }}
            >
              Save and come back later
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
