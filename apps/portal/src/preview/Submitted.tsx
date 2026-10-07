// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of the confirmation after sending: a calm panel with the reference,
// what happens next in order, and a plain "you do not need to do anything".

import { Link, PageHeading, Tag, buttonClassName } from '@pixel-scientists/ui';

import { PageColumn } from '../PageColumn.tsx';
import { ContactLine, Section, Steps, TickIcon } from './parts.tsx';
import { applicant, application, caseOfficer, funder, pounds, round } from './story.ts';

const steps = [
  {
    title: 'We check you can apply',
    text: 'We check that your organisation and your project fit the fund. We will email you if we need to ask you anything.',
  },
  {
    title: 'A panel reads your application',
    text: 'People who know your area read every application. Each one is scored against the same questions.',
  },
  {
    title: `You hear our decision by ${round.decisionsBy}`,
    text: 'We will email you as soon as the decision is ready, and you can read it in Your applications. We do not tell anyone the decision before we tell you.',
  },
];

/** The page after "Submit application". It says it worked, and that nothing more is needed. */
export default function Submitted() {
  return (
    <PageColumn>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <Tag tone="info">Design preview</Tag>
          {round.programme}, {round.name}
        </div>
        <div className="flex flex-col gap-6 rounded-lg border border-divider bg-surface p-6 shadow-(--shadow-raised) sm:p-8">
          <span
            aria-hidden="true"
            className="grid size-12 place-items-center rounded-full bg-success-soft text-success"
          >
            <TickIcon className="size-6" />
          </span>
          <div className="flex flex-col gap-3">
            <PageHeading className="text-3xl sm:text-4xl">Application submitted</PageHeading>
            <p className="max-w-prose text-lg text-ink">
              Thank you. We have received your application for {application.project}.
            </p>
          </div>
          <dl className="grid gap-x-8 gap-y-4 border-y border-divider py-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <dt className="text-sm font-medium text-muted">Your reference</dt>
              <dd className="text-3xl font-semibold tracking-tight text-ink tabular-nums">
                {application.reference}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm font-medium text-muted">Sent</dt>
              <dd className="text-body text-ink">{application.submitted}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm font-medium text-muted">Amount you asked for</dt>
              <dd className="text-body text-ink tabular-nums">{pounds(application.requested)}</dd>
            </div>
          </dl>
          <p className="max-w-prose text-body text-ink">
            We have emailed a copy to {applicant.email}. Keep your reference in case you need to
            contact us.
          </p>
          <p className="text-lg font-semibold text-ink">You do not need to do anything now.</p>
        </div>
      </div>

      <Section title="What happens next">
        <Steps steps={steps} />
      </Section>

      <div className="flex flex-col gap-4 border-t border-divider pt-8">
        <div>
          <Link to="/applications" className={buttonClassName('secondary', 'w-full sm:w-auto')}>
            Go to your applications
          </Link>
        </div>
        <p className="max-w-prose text-body text-muted">
          Spotted a mistake, or have a question? Contact {caseOfficer.name} and give your reference:{' '}
          <ContactLine email={funder.email} phone={funder.phone} />.
        </p>
      </div>
    </PageColumn>
  );
}
