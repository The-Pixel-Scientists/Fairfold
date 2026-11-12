// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A member filling in and submitting an application for an applicant who
// cannot use the portal (the alternative route). Two steps on one page, so a
// refusal from the server can put the member back on the field it names:
// the answers, saved as the member asks, then a check of what will be sent.
// The banner says whose application it is on both.

import { ProblemError } from '@pixel-scientists/domain/api';
import { visibleFields } from '@pixel-scientists/domain/forms';
import type { Answers } from '@pixel-scientists/domain/forms';
import {
  Button,
  EmptyState,
  FormSection,
  PageHeader,
  PageHeading,
  useCan,
  useLeaveGuard,
  useLoad,
  useNavigate,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import type { AssistedApplication } from '../../../contracts/index.ts';
import { useParam } from '../../programme/Page.tsx';
import { PROGRAMMES_PATH, roundPath } from '../../programme/paths.ts';
import { submissionPath } from '../paths.ts';
import { savable } from './answers.ts';
import { Banner } from './Banner.tsx';
import { CheckStep } from './CheckStep.tsx';
import { helpers } from './helpers.ts';
import { loadAssisted, saveAssisted } from './loaders.ts';
import { problemsOf } from './problems.ts';
import type { Problems } from './problems.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface Notice {
  text: string;
  /** Another save got there first. */
  stale: boolean;
}

function Journey({
  application,
  reload,
}: {
  application: AssistedApplication;
  reload: () => void;
}) {
  const navigate = useNavigate();
  const { definition } = application.form;
  const [answers, setAnswers] = useState<Answers>(application.answers);
  const [saved, setSaved] = useState<{ answers: Answers; version: number }>({
    answers: application.answers,
    version: application.answersVersion,
  });
  const [step, setStep] = useState<'answers' | 'check'>('answers');
  const [problems, setProblems] = useState<Problems>({ list: [], attempt: 0 });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const answersForm = useRef<HTMLFormElement>(null);
  const { name } = application.organisation;

  const { body, held } = savable(definition, answers, saved.answers);
  const dirty = !same(body, saved.answers);
  useLeaveGuard(
    (dirty || held.length > 0) && !done,
    'Some of your answers are not saved. If you leave this page, you may lose them.',
  );

  /** Saves what has changed. Gives the questions that cannot be saved yet, or null if the save failed. */
  async function save(): Promise<string[] | null> {
    if (!dirty) return held;
    setNotice(null);
    try {
      const result = await saveAssisted(application.id, { basedOn: saved.version, answers: body });
      setSaved({ answers: body, version: result.answersVersion });
      return held;
    } catch (error) {
      const failed = problemsOf(error);
      setNotice({
        text: failed.detail,
        stale: error instanceof ProblemError && error.status === 409,
      });
      setProblems(({ attempt }) => ({ list: failed.list, attempt: attempt + 1 }));
      return null;
    }
  }

  async function run(then?: (unsaved: string[]) => void) {
    if (pending) return;
    setPending(true);
    const unsaved = await save();
    setPending(false);
    if (unsaved !== null) then?.(unsaved);
  }

  function check(unsaved: string[]) {
    if (unsaved.length === 0) {
      setStep('check');
      return;
    }
    setProblems(({ attempt }) => ({
      list: unsaved.map((field) => ({ field, message: 'Fix this answer so it can be saved.' })),
      attempt: attempt + 1,
    }));
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Programmes', to: PROGRAMMES_PATH },
          { label: application.round.title, to: roundPath(application.round.id) },
          { label: name },
        ]}
        title={`Application for ${name}`}
        description={
          step === 'answers'
            ? 'Fill in the answers, then check what will be sent.'
            : 'Check what will be sent.'
        }
      />
      <Banner organisation={name} contact={application.contact.name} />
      {notice && (
        <div
          role="alert"
          className="flex max-w-prose flex-col items-start gap-2 rounded-md border border-danger p-3"
        >
          <p className="font-medium text-danger">{notice.text}</p>
          {notice.stale && <Button onClick={reload}>Show the latest saved answers</Button>}
        </div>
      )}
      {step === 'answers' ? (
        <form
          ref={answersForm}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void run(check);
          }}
          className="flex flex-col gap-10"
        >
          {definition.sections.map((section) => (
            <FormSection
              key={section.id}
              section={section}
              visible={visibleFields(definition, answers)}
              answers={answers}
              problems={problems.list}
              attempt={problems.attempt}
              helpers={helpers}
              onChange={(fieldId, value) => {
                setAnswers((current) => ({ ...current, [fieldId]: value }));
              }}
            />
          ))}
          <div className="flex flex-col items-start gap-3 border-t border-divider pt-6">
            <p role="status" className="text-sm text-muted">
              {dirty
                ? 'You have changes that are not saved.'
                : 'Everything is saved. You can leave and come back.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                aria-disabled={pending || undefined}
                onClick={() => {
                  void run();
                }}
              >
                Save answers
              </Button>
              <Button type="submit" variant="primary" aria-disabled={pending || undefined}>
                Save and check answers
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <CheckStep
          application={application}
          answers={answers}
          version={saved.version}
          onBack={(controlId) => {
            setStep('answers');
            // The button that was focused has gone: without a control to go to, start at the first section.
            requestAnimationFrame(() => {
              const target =
                controlId === undefined
                  ? answersForm.current?.querySelector<HTMLElement>('h2')
                  : document.getElementById(controlId);
              if (controlId === undefined) target?.setAttribute('tabindex', '-1');
              target?.focus();
            });
          }}
          onRefused={(list, text) => {
            setProblems(({ attempt }) => ({ list, attempt: attempt + 1 }));
            setNotice({ text, stale: false });
            setStep('answers');
          }}
          onSubmitted={() => {
            setDone(true);
            navigate(submissionPath(application.id));
          }}
        />
      )}
    </>
  );
}

function Assisted({ applicationId }: { applicationId: string }) {
  const { state, retry } = useLoad(loadAssisted, applicationId);
  return (
    <>
      {state.status !== 'ready' && <PageHeader title="Application" />}
      <WhenLoaded state={state} label="Loading the application" retry={retry}>
        {(application) => <Journey application={application} reload={retry} />}
      </WhenLoaded>
    </>
  );
}

/** An application a member is filling in for an applicant: `/assisted-applications/:applicationId`. */
export default function AssistedPage() {
  const applicationId = useParam('applicationId');
  if (useCan('grants.applications.assist')) {
    return (
      <div className="flex flex-col gap-stack">
        <Assisted applicationId={applicationId} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-stack">
      <PageHeading>Application</PageHeading>
      <EmptyState title="You cannot submit for applicants">
        <p>Ask an administrator at your funder to give you the programme manager role.</p>
      </EmptyState>
    </div>
  );
}
