// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Equality monitoring, after an application is sent. Every question is
// optional and the whole step can be skipped. The answers are special category
// data: they live in this component only, never in storage, an address, a page
// title or a draft, and are gone if the applicant leaves before sending them.

import { ProblemError } from '@pixel-scientists/domain/api';
import { answersSchema, visibleFields } from '@pixel-scientists/domain/forms';
import type { Answers, FormDefinition } from '@pixel-scientists/domain/forms';
import {
  getApplication,
  getMonitoringForm,
  getMonitoringResponse,
  monitoringMessages,
  preferNotToSay,
  saveMonitoringResponse,
  withdrawMonitoringResponse,
} from '@pixel-scientists/grants/contracts';
import type {
  Application,
  MonitoringForm,
  MonitoringResponse,
} from '@pixel-scientists/grants/contracts';
import {
  AnswerView,
  Button,
  Checkbox,
  ErrorSummary,
  FormSection,
  Link,
  buttonClassName,
  useLeaveGuard,
  useParams,
} from '@pixel-scientists/ui';
import { useCallback, useEffect, useState } from 'react';

import { callApi } from '../api.ts';
import { PageIntro } from '../PageColumn.tsx';
import { applicationPath } from '../paths.ts';
import { useRead } from '../party/useRead.ts';
import { closingTime, ukTimeOf } from './format.ts';
import { helpers } from './helpers.ts';
import { ApplyPage, ApplyScreen } from './parts.tsx';
import type { View } from './parts.tsx';
import { crumbs, loadingApplication } from './views.tsx';

interface Loaded {
  application: Application;
  form: MonitoringForm;
  response: MonitoringResponse | null;
}

/** Every question must offer "Prefer not to say". If one does not, the questions are not shown. */
function offersPreferNotToSay(definition: FormDefinition): boolean {
  return definition.sections.every((section) =>
    section.fields.every(
      (field) =>
        field.type === 'content' ||
        ('options' in field && field.options.some(({ value }) => value === preferNotToSay.value)),
    ),
  );
}

function Skip({ application }: { application: Application }) {
  return (
    <Link
      to={applicationPath(application.id)}
      className={buttonClassName('secondary', 'w-full sm:w-auto')}
    >
      Skip these questions
    </Link>
  );
}

const promises = [
  'You do not have to answer. Every question has a "Prefer not to say" option.',
  'We only use your answers to count totals. Staff and reviewers never see them next to your application.',
  'Your answers have no effect on your application or on whether you get a grant.',
  'We do not save anything until you send your answers. If you leave this page first, they are thrown away.',
];

function Explanation({ form }: { form: MonitoringForm }) {
  return (
    <>
      <ul
        role="list"
        className="flex max-w-prose list-disc flex-col gap-3 pl-6 text-body text-ink marker:text-muted"
      >
        {promises.map((text) => (
          <li key={text} className="pl-1">
            {text}
          </li>
        ))}
      </ul>
      <p className="max-w-prose text-body text-ink">
        You can answer until {closingTime(form.closesAt, form.timeZone)}. This is privacy notice
        version {form.privacyNoticeVersion}.
      </p>
    </>
  );
}

interface AnsweredProps {
  application: Application;
  form: MonitoringForm;
  response: MonitoringResponse;
  notice: string | null;
  onWithdrawn: () => void;
}

function Answered({ application, form, response, notice, onWithdrawn }: AnsweredProps) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function withdraw() {
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      await callApi(withdrawMonitoringResponse, { params: { applicationId: application.id } });
      onWithdrawn();
    } catch {
      setProblem('We could not delete your answers. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <>
      <PageIntro
        title="Your monitoring answers"
        breadcrumbs={crumbs(application, 'Equality monitoring')}
      >
        {notice !== null && <p role="status">{notice}</p>}
        <p>
          You agreed to these answers being used on {ukTimeOf(response.consentGivenAt)}. If you
          withdraw them, we delete them. Your application does not change.
        </p>
      </PageIntro>
      <AnswerView
        sections={form.definition.sections}
        visible={visibleFields(form.definition, response.answers)}
        answers={response.answers}
        helpers={helpers}
        headingLevel="h2"
      />
      {problem !== null && (
        <p role="alert" className="max-w-prose text-body font-medium text-danger">
          {problem}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="primary"
          aria-disabled={pending || undefined}
          className="w-full sm:w-auto"
          onClick={() => {
            void withdraw();
          }}
        >
          Withdraw my answers
        </Button>
        <Link
          to={applicationPath(application.id)}
          className={buttonClassName('secondary', 'w-full sm:w-auto')}
        >
          Back to your application
        </Link>
      </div>
    </>
  );
}

function Withdrawn({ application }: { application: Application }) {
  return (
    <>
      <PageIntro title="Your answers are deleted" breadcrumbs={crumbs(application)}>
        <p role="status">
          We have deleted your monitoring answers. Your application has not changed.
        </p>
      </PageIntro>
      <div>
        <Link
          to={applicationPath(application.id)}
          className={buttonClassName('primary', 'w-full sm:w-auto')}
        >
          Back to your application
        </Link>
      </div>
    </>
  );
}

interface QuestionsProps {
  application: Application;
  form: MonitoringForm;
  onSent: (response: MonitoringResponse) => void;
}

function Questions({ application, form, onSent }: QuestionsProps) {
  const [step, setStep] = useState<'intro' | 'questions'>('intro');
  const [answers, setAnswers] = useState<Answers>({});
  const [consent, setConsent] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [step]);
  useLeaveGuard(
    step === 'questions' && (consent || Object.keys(answers).length > 0),
    'Your answers are not saved. If you leave this page, they are thrown away.',
  );

  const { definition } = form;
  const crumb = crumbs(application, 'Equality monitoring');

  if (!offersPreferNotToSay(definition)) {
    return (
      <PageIntro title="Equality monitoring" breadcrumbs={crumb}>
        <p>
          We cannot show these questions at the moment. Contact the funder if you would like to
          answer them.
        </p>
        <div>
          <Skip application={application} />
        </div>
      </PageIntro>
    );
  }

  if (step === 'intro') {
    return (
      <>
        <PageIntro title="Equality monitoring" breadcrumbs={crumb}>
          <p>
            Your application has been sent. You can now answer a few questions that help the funder
            check it is reaching everyone.
          </p>
        </PageIntro>
        <Explanation form={form} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="primary"
            className="w-full sm:w-auto"
            onClick={() => {
              setStep('questions');
            }}
          >
            Answer monitoring questions
          </Button>
          <Skip application={application} />
        </div>
      </>
    );
  }

  async function send() {
    if (pending) return;
    setAttempt((count) => count + 1);
    setProblem(null);
    if (!consent) return;
    setPending(true);
    try {
      const response = await callApi(saveMonitoringResponse, {
        params: { applicationId: application.id },
        body: {
          formVersionId: form.formVersionId,
          answers: answersSchema.parse(answers),
          consent,
          privacyNoticeVersion: form.privacyNoticeVersion,
        },
      });
      onSent(response);
    } catch (error) {
      setProblem(
        error instanceof ProblemError && error.status >= 400 && error.status < 500
          ? error.detail
          : 'We could not send your answers. Check your connection and try again.',
      );
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="flex flex-col gap-10"
    >
      <PageIntro title="Equality monitoring questions" breadcrumbs={crumb}>
        <p>All of these are optional. We do not save them until you send them.</p>
      </PageIntro>
      {definition.sections.map((section) => (
        <FormSection
          key={section.id}
          section={section}
          visible={visibleFields(definition, answers)}
          answers={answers}
          helpers={helpers}
          headingLevel="h2"
          onChange={(fieldId, value) => {
            setAnswers((current) => {
              const rest = Object.fromEntries(
                Object.entries(current).filter(([id]) => id !== fieldId),
              );
              return value === null ? rest : { ...rest, [fieldId]: value };
            });
          }}
        />
      ))}
      <div className="flex max-w-prose flex-col gap-3 border-t border-divider pt-6">
        {attempt > 0 && !consent && (
          <ErrorSummary
            key={attempt}
            errors={[{ fieldId: 'monitoring-consent', message: monitoringMessages.consent }]}
          />
        )}
        <Checkbox
          id="monitoring-consent"
          label={`I agree to my answers being used for equality monitoring, as privacy notice version ${form.privacyNoticeVersion} says.`}
          checked={consent}
          onCheckedChange={setConsent}
          className="justify-start text-left"
        />
        {problem !== null && (
          <p role="alert" className="text-body font-medium text-danger">
            {problem}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="submit"
            variant="primary"
            aria-disabled={pending || undefined}
            className="w-full sm:w-auto"
          >
            Send my answers
          </Button>
          <Skip application={application} />
        </div>
      </div>
    </form>
  );
}

function Flow(loaded: Loaded) {
  const [response, setResponse] = useState(loaded.response);
  const [state, setState] = useState<'answering' | 'sent' | 'withdrawn'>('answering');
  // The button that was pressed is gone after sending or withdrawing, so the new heading takes focus.
  useEffect(() => {
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [state]);
  if (state === 'withdrawn') return <Withdrawn application={loaded.application} />;
  if (response !== null) {
    return (
      <Answered
        application={loaded.application}
        form={loaded.form}
        response={response}
        notice={state === 'sent' ? 'Thank you. We have your answers.' : null}
        onWithdrawn={() => {
          setResponse(null);
          setState('withdrawn');
        }}
      />
    );
  }
  return (
    <Questions
      application={loaded.application}
      form={loaded.form}
      onSent={(sent) => {
        setResponse(sent);
        setState('sent');
      }}
    />
  );
}

const view = (loaded: Loaded): View => ({ body: <Flow {...loaded} /> });

function Monitoring() {
  const { applicationId = '' } = useParams();
  const read = useCallback(async (): Promise<Loaded> => {
    const params = { applicationId };
    const [application, form, mine] = await Promise.all([
      callApi(getApplication, { params }),
      callApi(getMonitoringForm, { params }),
      callApi(getMonitoringResponse, { params }),
    ]);
    return { application, form, response: mine.response };
  }, [applicationId]);
  const { read: loaded, retry } = useRead(read);
  return (
    <ApplyPage
      read={loaded}
      retry={retry}
      loading={loadingApplication}
      missing={{
        text: 'There are no equality monitoring questions for this application.',
        to: applicationPath(applicationId),
        link: 'Back to your application',
      }}
      view={view}
    />
  );
}

/** The optional equality monitoring step: `/applications/:applicationId/monitoring`. */
export default function MonitoringPage() {
  return (
    <ApplyScreen>
      <Monitoring />
    </ApplyScreen>
  );
}
