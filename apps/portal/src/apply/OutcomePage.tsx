// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What the applicant is told once the funder releases a decision: the outcome,
// what it means and what they can do next. The API sends an outcome only from
// release (architecture rule 8), so until then this page says no more than the
// others do: the name and the status. It never shows a score, a reviewer or a
// reason.

import { formatMoney } from '@pixel-scientists/domain/platform';
import type { Application } from '@pixel-scientists/grants/contracts';
import { Link, buttonClassName, cx, useParams } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { APPLICATIONS_PATH, PROGRAMMES_PATH } from '../paths.ts';
import { ApplyPage, ApplyScreen, Block, Steps } from './parts.tsx';
import type { View } from './parts.tsx';
import { useApplicationRead } from './reads.ts';
import { StatusTag } from './status.tsx';
import { crumbs, loadingApplication, nameOf, noApplication, statusView } from './views.tsx';

type Released = NonNullable<Application['outcome']>;

const wrap = '[overflow-wrap:anywhere]';

/** The outcome in a panel: the status, then what it says, in a colour that backs the words up. */
function ResultPanel({
  application,
  label,
  className,
  children,
}: {
  application: Application;
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx('flex flex-col gap-4 rounded-lg border border-divider p-6 sm:p-8', className)}
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-muted">
        {label}
        <StatusTag status={application.status} />
      </p>
      {children}
      <p className={cx('max-w-prose text-body text-ink', wrap)}>
        This is for {application.organisation.name}, from {nameOf(application)}.
      </p>
    </div>
  );
}

function Choices({ items }: { items: readonly string[] }) {
  return (
    <ul
      role="list"
      className="flex max-w-prose list-disc flex-col gap-3 pl-6 text-body text-ink marker:text-muted"
    >
      {items.map((item) => (
        <li key={item} className="pl-1">
          {item}
        </li>
      ))}
    </ul>
  );
}

const toProgrammes = (
  <Link to={PROGRAMMES_PATH} className={buttonClassName('secondary', 'w-full sm:w-auto')}>
    See programmes you can apply to
  </Link>
);

/** The ways on from any outcome, at the foot of the page. */
function Ways({ more }: { more?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-divider pt-8 sm:flex-row sm:items-center sm:gap-6">
      {more}
      <Link to={APPLICATIONS_PATH} className="inline-flex min-h-control items-center">
        Back to your applications
      </Link>
    </div>
  );
}

const awardedSteps = [
  {
    title: 'Read our email',
    text: 'We email you when a decision is ready. It may tell you more about what to do next.',
  },
  {
    title: 'We tell you about your grant',
    text: 'We will tell you the rules that come with your grant, and how and when we pay it. You do not need to do anything until then.',
  },
];

function Awarded({ application, amount }: { application: Application; amount: string }) {
  return (
    <>
      <ResultPanel application={application} label="Your grant" className="bg-success-soft">
        <p className="text-lg text-ink">
          You have been awarded{' '}
          <span className="mt-1 block text-4xl font-semibold tracking-tight tabular-nums">
            {amount}
          </span>
        </p>
      </ResultPanel>
      <Block title="What happens next">
        <Steps steps={awardedSteps} />
      </Block>
      <Ways />
    </>
  );
}

function Waitlisted({ application }: { application: Application }) {
  return (
    <>
      <ResultPanel application={application} label="Your application" className="bg-info-soft">
        <p className="text-2xl font-semibold tracking-tight text-ink">
          We cannot offer you a grant yet.
        </p>
      </ResultPanel>
      <Block title="What the waiting list means">
        <p className="max-w-prose text-body text-ink">
          A waiting list is for applications we cannot fund yet, but may be able to fund later.
        </p>
        <p className="max-w-prose text-body text-ink">
          If we can offer you a grant from this round, we will email you. We cannot say if or when
          this will happen.
        </p>
      </Block>
      <Block title="What you can do">
        <Choices
          items={[
            'You do not need to do anything. We will email you if this changes.',
            'Because we cannot promise a grant, please do not count on this money yet.',
            'You can apply to other programmes while you wait.',
          ]}
        />
      </Block>
      <Ways more={toProgrammes} />
    </>
  );
}

function NotFunded({ application }: { application: Application }) {
  return (
    <>
      <ResultPanel application={application} label="Your application" className="bg-sunken">
        <p className="text-2xl font-semibold tracking-tight text-ink">
          We could not offer you a grant this time.
        </p>
      </ResultPanel>
      <Block title="What you can do next">
        <Choices
          items={[
            'Look for another programme that fits your project. You can start a new application when you are ready.',
            'Your organisation’s details are saved, so a new application is quicker to start.',
            'Check back to see if this programme opens another round.',
          ]}
        />
      </Block>
      <Ways more={toProgrammes} />
    </>
  );
}

/** What each released outcome says at the top of the page, and the body that follows. */
function outcomeView(application: Application, outcome: Released): View {
  const heading = (title: string, intro: string) => ({
    title,
    breadcrumbs: crumbs(application, 'Your outcome'),
    intro: <p>{intro}</p>,
  });
  switch (outcome.result) {
    case 'accepted':
      return {
        heading: heading(
          'Your application was successful',
          'Congratulations, and thank you for taking the time to apply.',
        ),
        body: <Awarded application={application} amount={formatMoney(outcome.amount)} />,
      };
    case 'waitlisted':
      return {
        heading: heading(
          'You are on our waiting list',
          'Thank you for applying. We know it is hard to wait for news.',
        ),
        body: <Waitlisted application={application} />,
      };
    case 'declined':
      return {
        heading: heading(
          'We could not fund your application',
          'Thank you for applying. We know this is not the news you hoped for.',
        ),
        body: <NotFunded application={application} />,
      };
  }
}

/** Before release there is no outcome to show, so this page is the status page. */
const view = (application: Application): View =>
  application.outcome === null
    ? statusView(application)
    : outcomeView(application, application.outcome);

function Outcome() {
  const { applicationId = '' } = useParams();
  const { read, retry } = useApplicationRead(applicationId);
  return (
    <ApplyPage
      read={read}
      retry={retry}
      loading={loadingApplication}
      missing={noApplication}
      view={view}
    />
  );
}

/** The outcome of a released decision: `/applications/:applicationId/outcome`. */
export default function OutcomePage() {
  return (
    <ApplyScreen>
      <Outcome />
    </ApplyScreen>
  );
}
