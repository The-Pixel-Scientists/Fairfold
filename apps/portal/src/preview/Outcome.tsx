// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of the outcome an applicant sees once the funder has released it:
// the amount, the conditions, what happens next and who to ask. It shows
// nothing before release, and never a score or a reviewer.

import { Button, Link, SummaryList, Tag } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { PageColumn } from '../PageColumn.tsx';
import { ContactLine, ScreenHeader, Section, Steps, TickIcon } from './parts.tsx';
import { applicant, application, caseOfficer, funder, pounds, round } from './story.ts';

const conditions = [
  'Spend the grant on the costs in your budget. Ask us first if you need to change how you spend it.',
  'Make sure every volunteer and driver who works with older people has a DBS (Disclosure and Barring Service) check before they start.',
  'Send us a short progress report after six months, and a final report within a month of the project ending.',
  'Tell us if you get other money for the same costs.',
];

const half = application.requested / 2;
const acceptBy = '29 April 2027';

const steps = [
  {
    title: 'Accept your grant conditions',
    text: `Accept them on this page by ${acceptBy}, 28 days from your decision. Then we email your grant agreement to ${applicant.email} for your trustees to sign.`,
  },
  {
    title: 'We pay your grant',
    text: `We pay the first ${pounds(half)} within 10 working days of getting your signed agreement. We pay the second ${pounds(half)} after your progress report.`,
  },
  {
    title: 'Start your project',
    text: 'Your grant starts on 1 June 2027. Tell us if your first lunch moves from Tuesday 1 June.',
  },
];

/** What the applicant sees after their decision is released. A decision is private until then. */
export default function Outcome() {
  const [accepted, setAccepted] = useState(false);
  const confirmation = useRef<HTMLParagraphElement>(null);

  // The button goes once it is pressed, so move focus to what replaces it.
  useEffect(() => {
    if (accepted) confirmation.current?.focus();
  }, [accepted]);

  return (
    <PageColumn>
      <ScreenHeader
        title="Your application was successful"
        eyebrow={`${round.programme}, ${round.name}`}
        breadcrumbs={[
          { label: 'Your applications', to: '/applications' },
          { label: application.project },
        ]}
      >
        <p>
          Congratulations. {funder.name} will give {applicant.organisation}{' '}
          {pounds(application.requested)} for {application.project}. Thank you for taking the time
          to apply.
        </p>
      </ScreenHeader>

      <div className="flex flex-col gap-4 rounded-lg border border-divider bg-success-soft p-6 sm:p-8">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-muted">
          Your grant
          <Tag tone="success">Awarded</Tag>
        </p>
        <p className="text-4xl font-semibold tracking-tight text-ink tabular-nums">
          {pounds(application.requested)}
        </p>
        <p className="max-w-prose text-body text-ink">
          For {application.project}. You asked for {pounds(application.requested)}, and we are
          funding all of it.
        </p>
      </div>

      <blockquote className="flex max-w-prose flex-col gap-3 border-l-2 border-edge pl-5">
        <p className="text-lg text-ink">
          We were glad to read about the lunch club. A hot meal and a friendly face every week is
          exactly the sort of project this fund is for. We look forward to seeing it start.
        </p>
        <footer className="text-body text-muted">
          {caseOfficer.name}, {caseOfficer.role}, {funder.name}
        </footer>
      </blockquote>

      <Section title="Your grant at a glance">
        <SummaryList
          items={[
            { term: 'Reference', value: application.reference },
            { term: 'Fund', value: `${round.programme}, ${round.name}` },
            { term: 'Grant period', value: '1 June 2027 to 25 April 2028' },
            { term: 'Decision sent', value: '1 April 2027' },
          ]}
        />
      </Section>

      <Section title="Conditions of your grant">
        <p className="max-w-prose text-body text-muted">
          These come with the grant. They are in your grant agreement too. Please accept them by{' '}
          {acceptBy}.
        </p>
        <ol className="flex max-w-prose list-decimal flex-col gap-3 pl-6 text-body text-ink marker:font-medium marker:text-muted">
          {conditions.map((condition) => (
            <li key={condition} className="pl-1">
              {condition}
            </li>
          ))}
        </ol>
        {accepted ? (
          <p
            ref={confirmation}
            role="status"
            tabIndex={-1}
            className="flex max-w-prose items-start gap-2 text-body font-medium text-success"
          >
            <span className="mt-1 shrink-0">
              <TickIcon />
            </span>
            You have accepted these conditions. We are emailing your grant agreement to{' '}
            {applicant.email}.
          </p>
        ) : (
          <div>
            <Button
              variant="primary"
              className="w-full sm:w-auto"
              onClick={() => {
                setAccepted(true);
              }}
            >
              Accept the conditions
            </Button>
          </div>
        )}
      </Section>

      <Section title="What happens next">
        <Steps steps={steps} />
      </Section>

      <Section title="Questions about your grant?">
        <p className="max-w-prose text-body text-ink">
          {caseOfficer.name}, {caseOfficer.role}, can help:{' '}
          <ContactLine email={funder.email} phone={funder.phone} />. We answer {caseOfficer.hours}.
        </p>
      </Section>

      <div className="flex flex-col gap-3 border-t border-divider pt-8 sm:flex-row sm:items-center sm:gap-6">
        <Button className="w-full sm:w-auto">Download your decision letter (PDF, 96 KB)</Button>
        <Link to="/applications" className="inline-flex min-h-control items-center">
          Back to your applications
        </Link>
      </div>
    </PageColumn>
  );
}
