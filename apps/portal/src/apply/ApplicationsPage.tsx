// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Everything the applicant has started or sent, with the status they are
// allowed to see. A sent application can be withdrawn until its decision is
// released, after asking them to confirm. Stages, scores and unreleased
// decisions never reach this page: the API sends only what an applicant may see.

import { ProblemError } from '@pixel-scientists/domain/api';
import {
  applicantStatuses,
  listApplications,
  withdrawApplication,
} from '@pixel-scientists/grants/contracts';
import type {
  ApplicantStatus,
  ApplicationList,
  ApplicationSummary,
} from '@pixel-scientists/grants/contracts';
import { Button, Dialog, EmptyState, Link, Tag, buttonClassName } from '@pixel-scientists/ui';
import type { TagTone } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { callApi } from '../api.ts';
import { ReadPage, homeCrumb } from '../party/parts.tsx';
import { useRead } from '../party/useRead.ts';
import { PROGRAMMES_PATH, applicationPath, submittedPath } from '../paths.ts';
import { closingTime, dateOf } from './format.ts';
import { ApplyScreen, Block } from './parts.tsx';

const TITLE = 'Your applications';
const breadcrumbs = [homeCrumb, { label: TITLE }];

const tones: Record<ApplicantStatus, TagTone> = {
  in_progress: 'info',
  submitted: 'info',
  under_review: 'info',
  awarded: 'success',
  waitlisted: 'warning',
  not_funded: 'neutral',
  withdrawn: 'neutral',
};

/** What each status means for the applicant. Nothing here hints at a decision before it is released. */
const notes: Partial<Record<ApplicantStatus, string>> = {
  in_progress: 'Not sent yet. Everything you have written is saved.',
  submitted: 'We have your application. We will email you when there is news.',
  under_review: 'We are reading your application. We will email you when there is news.',
  withdrawn: 'You withdrew this application.',
};

const readApplications = () => callApi(listApplications, {});

const nameOf = ({ round }: Pick<ApplicationSummary, 'round'>) =>
  `${round.programmeTitle}, ${round.title}`;

/** Only a sent application whose decision is not released can be withdrawn. */
const canWithdraw = (status: ApplicantStatus) =>
  status === 'submitted' || status === 'under_review';

function Withdraw({
  application,
  onWithdrawn,
}: {
  application: ApplicationSummary;
  onWithdrawn: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function withdraw() {
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      await callApi(withdrawApplication, { params: { applicationId: application.id } });
      setOpen(false);
      onWithdrawn();
    } catch (error) {
      setProblem(
        error instanceof ProblemError && error.status >= 400 && error.status < 500
          ? error.detail
          : 'We could not withdraw your application. Check your connection and try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        className="w-full sm:w-auto"
        onClick={() => {
          setProblem(null);
          setOpen(true);
        }}
      >
        Withdraw application <span className="sr-only">for {nameOf(application)}</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
        title="Withdraw this application?"
        description={
          <>
            <p>
              You are withdrawing your application to {nameOf(application)}. We will not make a
              decision on it. You cannot undo this.
            </p>
            <p className="mt-2">
              To apply again, you must start a new application while the programme is still open.
            </p>
          </>
        }
        actions={
          <>
            <Button
              variant="danger"
              aria-disabled={pending || undefined}
              onClick={() => void withdraw()}
            >
              {pending ? 'Withdrawing…' : 'Withdraw application'}
            </Button>
            <Button
              variant="primary"
              data-autofocus
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep my application
            </Button>
          </>
        }
      >
        {problem && (
          <p role="alert" className="text-body font-medium text-danger">
            {problem}
          </p>
        )}
      </Dialog>
    </>
  );
}

interface CardProps {
  application: ApplicationSummary;
  status: ApplicantStatus;
  onWithdrawn: () => void;
}

function Card({ application, status, onWithdrawn }: CardProps) {
  const { round, organisation } = application;
  const facts: (readonly [string, string])[] = [
    ['Organisation', organisation.name],
    ...(status === 'in_progress'
      ? [
          ['Last saved', dateOf(application.updatedAt)] as const,
          ['Closes', closingTime(round.closesAt, round.timeZone)] as const,
        ]
      : application.submittedAt === null
        ? []
        : [['Sent', dateOf(application.submittedAt)] as const]),
  ];
  const action =
    status === 'in_progress' ? (
      <Link
        to={applicationPath(application.id)}
        className={buttonClassName('primary', 'w-full sm:w-auto')}
      >
        Continue application <span className="sr-only">for {nameOf(application)}</span>
      </Link>
    ) : status === 'submitted' || status === 'under_review' ? (
      <Link
        to={submittedPath(application.id)}
        className={buttonClassName('secondary', 'w-full sm:w-auto')}
      >
        See what happens next <span className="sr-only">for {nameOf(application)}</span>
      </Link>
    ) : null;

  return (
    <li className="flex flex-col gap-5 rounded-lg border border-divider bg-surface p-5 shadow-(--shadow-raised) sm:p-6">
      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-muted">{round.programmeTitle}</p>
          <h3 className="text-lg font-semibold tracking-tight text-ink [overflow-wrap:anywhere]">
            {round.title}
          </h3>
        </div>
        <span>
          <Tag tone={tones[status]}>{applicantStatuses[status]}</Tag>
        </span>
      </div>
      <dl className="flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:gap-x-6">
        {facts.map(([term, value]) => (
          <div
            key={term}
            className="flex items-baseline justify-between gap-4 sm:min-w-0 sm:flex-col sm:justify-start sm:gap-0.5"
          >
            <dt className="shrink-0 text-sm font-medium text-muted">{term}</dt>
            <dd className="min-w-0 text-end text-body text-ink [overflow-wrap:anywhere] sm:text-start">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-4 border-t border-divider pt-4">
        {notes[status] && <p className="max-w-prose text-body text-muted">{notes[status]}</p>}
        {(action || canWithdraw(status)) && (
          <div className="flex flex-col gap-3 sm:flex-row">
            {action}
            {canWithdraw(status) && (
              <Withdraw application={application} onWithdrawn={onWithdrawn} />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Block title={title}>
      <ul role="list" className="flex flex-col gap-4">
        {children}
      </ul>
    </Block>
  );
}

function Applications({ applications }: ApplicationList) {
  const [withdrawn, setWithdrawn] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState('');
  const noticeElement = useRef<HTMLParagraphElement>(null);

  // The button that withdrew an application is gone, so the notice takes focus.
  useEffect(() => {
    if (notice !== '') noticeElement.current?.focus();
  }, [notice]);

  if (applications.length === 0) {
    return (
      <EmptyState
        title="You have not started an application"
        action={
          <Link to={PROGRAMMES_PATH} className={buttonClassName('primary')}>
            See programmes you can apply to
          </Link>
        }
      >
        <p>Choose a programme to read about it. You can start an application from there.</p>
      </EmptyState>
    );
  }

  const statusOf = (application: ApplicationSummary): ApplicantStatus =>
    withdrawn.includes(application.id) ? 'withdrawn' : application.status;
  const cards = (list: readonly ApplicationSummary[]) =>
    list.map((application) => (
      <Card
        key={application.id}
        application={application}
        status={statusOf(application)}
        onWithdrawn={() => {
          setWithdrawn((current) => [...current, application.id]);
          setNotice(`Your application to ${nameOf(application)} is withdrawn.`);
        }}
      />
    ));
  const toFinish = applications.filter((application) => statusOf(application) === 'in_progress');
  const sent = applications.filter((application) => statusOf(application) !== 'in_progress');

  return (
    <>
      <p ref={noticeElement} role="status" tabIndex={-1} className="empty:hidden">
        {notice}
      </p>
      {toFinish.length > 0 && <Group title="To finish">{cards(toFinish)}</Group>}
      {sent.length > 0 && <Group title="Sent">{cards(sent)}</Group>}
      <div className="border-t border-divider pt-6">
        <Link to={PROGRAMMES_PATH} className="inline-flex min-h-control items-center">
          See programmes you can apply to
        </Link>
      </div>
    </>
  );
}

function List() {
  const { read, retry } = useRead(readApplications);
  return (
    <ReadPage
      title={TITLE}
      breadcrumbs={breadcrumbs}
      intro={<p>Everything you have started or sent, in one place.</p>}
      read={read}
      retry={retry}
    >
      {(list) => <Applications {...list} />}
    </ReadPage>
  );
}

/** The applicant's applications: `/applications`. */
export default function ApplicationsPage() {
  return (
    <ApplyScreen>
      <List />
    </ApplyScreen>
  );
}
