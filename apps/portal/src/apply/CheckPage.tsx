// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Check your answers: every section read back with a way to change it, and
// each missing or wrong answer listed with a link to it. "Submit application"
// is offered only when nothing is missing. The server checks again on submit.

import { ProblemError } from '@pixel-scientists/domain/api';
import { checkEligibility, visibleFields } from '@pixel-scientists/domain/forms';
import { submitApplication } from '@pixel-scientists/grants/contracts';
import type { Application } from '@pixel-scientists/grants/contracts';
import {
  AnswerView,
  Button,
  Link,
  buttonClassName,
  useNavigate,
  useParams,
} from '@pixel-scientists/ui';
import { useState } from 'react';

import { callApi } from '../api.ts';
import { useFunderName } from '../funder.tsx';
import { applicationPath, eligibilityPath, sectionPath, submittedPath } from '../paths.ts';
import {
  ELIGIBILITY_SCREEN,
  problemsOf,
  questionsOn,
  shownIds,
  shownScreens,
  toFix,
} from './form.ts';
import type { Screen as QuestionScreen } from './form.ts';
import { helpers } from './helpers.ts';
import { ApplyPage, ApplyScreen, Block } from './parts.tsx';
import type { View } from './parts.tsx';
import { useApplicationRead } from './reads.ts';
import { crumbs, loadingApplication, noApplication, notDraft } from './views.tsx';

const screenPath = (application: Application, screen: QuestionScreen): string =>
  screen.id === ELIGIBILITY_SCREEN
    ? eligibilityPath(application.id)
    : sectionPath(application.id, screen.id);

interface Refusal {
  detail: string;
  reasons: string[];
  stale: boolean;
}

/** Why the API refused to take the application, in its words. */
function refusalOf(error: unknown): Refusal {
  if (error instanceof ProblemError && error.status === 409) {
    return {
      detail: 'Your answers were saved somewhere else since you opened this page.',
      reasons: [],
      stale: true,
    };
  }
  if (error instanceof ProblemError && error.status >= 400 && error.status < 500) {
    return {
      detail: error.detail,
      reasons: error.errors.map(({ message }) => message),
      stale: false,
    };
  }
  return {
    detail: 'We could not send your application. Check your connection and try again.',
    reasons: [],
    stale: false,
  };
}

function Answers({ application, reload }: { application: Application; reload: () => void }) {
  const navigate = useNavigate();
  const funder = useFunderName();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const { definition } = application.form;
  const { answers } = application;
  const screens = shownScreens(definition, answers);
  const shown = shownIds(definition, answers);
  const eligibility = checkEligibility(definition, answers);
  const fixes = toFix(screens, problemsOf(definition, answers, 'submit')).map((fix) => ({
    to: `${screenPath(application, fix.screen)}#${fix.controlId}`,
    text: `${fix.label}: ${fix.message}`,
  }));
  if (eligibility.status === 'stopped') {
    fixes.unshift({
      to: `${eligibilityPath(application.id)}#${eligibility.fieldId}`,
      text: `Check you can apply: ${eligibility.explanation}`,
    });
  }
  const complete = fixes.length === 0 && eligibility.status === 'eligible';

  async function submit() {
    if (pending) return;
    setPending(true);
    setRefusal(null);
    try {
      await callApi(submitApplication, {
        params: { applicationId: application.id },
        body: { basedOn: application.answersVersion },
      });
      navigate(submittedPath(application.id));
    } catch (error) {
      setRefusal(refusalOf(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {fixes.length > 0 && (
        <section
          aria-labelledby="to-fix"
          className="flex max-w-prose flex-col gap-3 rounded-md border-2 border-warning bg-warning-soft p-4"
        >
          <h2 id="to-fix" className="text-lg font-semibold text-ink">
            Before you can send your application
          </h2>
          <ul role="list" className="flex list-disc flex-col gap-1 pl-5">
            {fixes.map(({ to, text }) => (
              <li key={`${to}:${text}`} className="text-body text-ink">
                <Link to={to} className="inline-flex min-h-target items-center font-medium">
                  {text}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-10">
        {screens
          .filter((screen) => questionsOn(screen, shown).length > 0)
          .map((screen) => (
            <div key={screen.id} className="flex flex-col gap-2">
              <AnswerView
                sections={[screen]}
                visible={visibleFields(definition, answers)}
                answers={answers}
                helpers={helpers}
                headingLevel="h2"
              />
              <div>
                <Link
                  to={screenPath(application, screen)}
                  className="inline-flex min-h-target items-center"
                >
                  Change <span className="sr-only">{screen.title}</span>
                </Link>
              </div>
            </div>
          ))}
      </div>

      <Block title="Send your application" className="border-t border-divider pt-8">
        {complete ? (
          <>
            <p className="max-w-prose text-body text-ink">
              When you submit, we send your application to {funder ?? 'the funder'}. You cannot
              change it after that. You can still withdraw it.
            </p>
            {refusal && (
              <div role="alert" className="flex max-w-prose flex-col items-start gap-2">
                <p className="text-body font-medium text-danger">{refusal.detail}</p>
                {refusal.reasons.length > 0 && (
                  <ul role="list" className="list-disc pl-5 text-body text-danger">
                    {refusal.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
                {refusal.stale ? (
                  <Button onClick={reload}>Show the latest answers</Button>
                ) : (
                  <p className="text-body text-ink">Your answers are saved.</p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                variant="primary"
                aria-disabled={pending || undefined}
                className="w-full sm:w-auto"
                onClick={() => {
                  void submit();
                }}
              >
                {pending ? 'Submitting…' : 'Submit application'}
              </Button>
              <Link
                to={applicationPath(application.id)}
                className={buttonClassName('secondary', 'w-full sm:w-auto')}
              >
                Back to your application
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="max-w-prose text-body text-ink">
              You can send your application once everything above is done.
            </p>
            <div>
              <Link
                to={applicationPath(application.id)}
                className={buttonClassName('secondary', 'w-full sm:w-auto')}
              >
                Back to your application
              </Link>
            </div>
          </>
        )}
      </Block>
    </>
  );
}

function checkView(application: Application, reload: () => void): View {
  if (application.status !== 'in_progress') return notDraft(application);
  return {
    heading: {
      title: 'Check your answers',
      breadcrumbs: crumbs(application, 'Check your answers'),
      intro: (
        <p>
          Read through your answers before you send them. You can change anything. We have saved
          every answer, so you will not lose them.
        </p>
      ),
    },
    body: <Answers application={application} reload={reload} />,
  };
}

function Check() {
  const { applicationId = '' } = useParams();
  const { read, retry } = useApplicationRead(applicationId);
  return (
    <ApplyPage
      read={read}
      retry={retry}
      loading={loadingApplication}
      missing={noApplication}
      view={(application) => checkView(application, retry)}
    />
  );
}

/** Every answer, and what is missing, before sending: `/applications/:applicationId/check`. */
export default function CheckPage() {
  return (
    <ApplyScreen>
      <Check />
    </ApplyScreen>
  );
}
