// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The page after "Submit application": it says it worked, what happens next,
// and that nothing more is needed. It shows the status the applicant is allowed
// to see and nothing from inside the funder (architecture rule 8).

import { applicantStatuses } from '@pixel-scientists/grants/contracts';
import type { Application } from '@pixel-scientists/grants/contracts';
import { Link, buttonClassName, useParams } from '@pixel-scientists/ui';

import { useFunderName } from '../funder.tsx';
import { APPLICATIONS_PATH, applicationPath } from '../paths.ts';
import { dateAndTimeOf } from './format.ts';
import { ApplyPage, ApplyScreen, Block } from './parts.tsx';
import type { View } from './parts.tsx';
import { useApplicationRead } from './reads.ts';
import { crumbs, loadingApplication, nameOf, noApplication } from './views.tsx';

const steps = [
  {
    title: 'We check your application',
    text: 'We check that it is complete and fits the programme.',
  },
  {
    title: 'People read your application',
    text: 'The funder reads every application and compares them fairly.',
  },
  {
    title: 'You hear our decision',
    text: 'We email you when the decision is ready, and you can read it in Your applications. We tell nobody else first.',
  },
];

function Tick() {
  return (
    <span
      aria-hidden="true"
      className="grid size-12 place-items-center rounded-full bg-success-soft text-success"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.5 8.5l3 3 6-6.5" />
      </svg>
    </span>
  );
}

function Sent({ application }: { application: Application }) {
  const funder = useFunderName();
  return (
    <div className="flex flex-col gap-6 rounded-lg border border-divider bg-surface p-6 shadow-(--shadow-raised) sm:p-8">
      <Tick />
      <p className="max-w-prose text-lg text-ink">
        Thank you. We have received your application for {nameOf(application)}
        {funder === null ? '' : ` from ${funder}`}.
      </p>
      <dl className="grid gap-x-8 gap-y-4 border-y border-divider py-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-muted">Organisation</dt>
          <dd className="text-body text-ink [overflow-wrap:anywhere]">
            {application.organisation.name}
          </dd>
        </div>
        {application.submittedAt !== null && (
          <div className="flex flex-col gap-1">
            <dt className="text-sm font-medium text-muted">Sent</dt>
            <dd className="text-body text-ink">{dateAndTimeOf(application.submittedAt)}</dd>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-muted">Status</dt>
          <dd className="text-body text-ink">{applicantStatuses[application.status]}</dd>
        </div>
      </dl>
      <p className="text-lg font-semibold text-ink">You do not need to do anything now.</p>
    </div>
  );
}

function Steps() {
  return (
    <Block title="What happens next">
      <ol role="list" className="flex flex-col gap-5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full border border-edge bg-surface text-sm font-semibold text-ink tabular-nums"
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 max-w-prose flex-col gap-1 pt-0.5">
              <h3 className="text-body font-semibold text-ink">{step.title}</h3>
              <p className="text-body text-muted">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Block>
  );
}

const toApplications = (
  <div>
    <Link to={APPLICATIONS_PATH} className={buttonClassName('secondary', 'w-full sm:w-auto')}>
      Go to your applications
    </Link>
  </div>
);

function submittedView(application: Application): View {
  const { status } = application;
  if (status === 'in_progress') {
    return {
      heading: {
        title: 'Your application',
        breadcrumbs: crumbs(application),
        intro: <p>You have not sent this application yet.</p>,
      },
      body: (
        <div>
          <Link
            to={applicationPath(application.id)}
            className={buttonClassName('primary', 'w-full sm:w-auto')}
          >
            Continue application
          </Link>
        </div>
      ),
    };
  }
  if (status === 'submitted' || status === 'under_review') {
    return {
      heading: {
        title: 'Application submitted',
        breadcrumbs: [
          { label: 'Your applications', to: APPLICATIONS_PATH },
          { label: 'Application submitted' },
        ],
      },
      body: (
        <>
          <Sent application={application} />
          <Steps />
          {toApplications}
        </>
      ),
    };
  }
  return {
    heading: {
      title: 'Your application',
      breadcrumbs: crumbs(application),
      intro: (
        <p>
          {nameOf(application)}: {applicantStatuses[status]}.
        </p>
      ),
    },
    body: toApplications,
  };
}

function Submitted() {
  const { applicationId = '' } = useParams();
  const { read, retry } = useApplicationRead(applicationId);
  return (
    <ApplyPage
      read={read}
      retry={retry}
      loading={loadingApplication}
      missing={noApplication}
      view={submittedView}
    />
  );
}

/** What an application that has been sent looks like: `/applications/:applicationId/submitted`. */
export default function SubmittedPage() {
  return (
    <ApplyScreen>
      <Submitted />
    </ApplyScreen>
  );
}
