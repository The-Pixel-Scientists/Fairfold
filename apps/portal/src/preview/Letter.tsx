// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of the decision letter that comes with a released outcome, on a page
// that prints. "Print or save as PDF" opens the browser's own print window,
// which can save a PDF. The header and footer are left out of print, and the
// letter prints in ink on white paper whichever scheme the screen is in.

import { Button, Link } from '@pixel-scientists/ui';
import { useEffect } from 'react';

import { PageColumn } from '../PageColumn.tsx';
import { acceptBy, conditions, decisionSent, grantPeriod, note, steps } from './award.ts';
import { ContactLine, ScreenHeader, Section, Steps } from './parts.tsx';
import { applicant, application, caseOfficer, funder, pounds, round } from './story.ts';

/** Light colours for as long as the page is being printed, then the person's own scheme again. */
function usePaperColours() {
  useEffect(() => {
    const root = document.documentElement;
    let onScreen: string | undefined;
    const toPaper = () => {
      onScreen = root.dataset.scheme;
      root.dataset.scheme = 'light';
    };
    const toScreen = () => {
      if (onScreen !== undefined) root.dataset.scheme = onScreen;
      onScreen = undefined;
    };
    window.addEventListener('beforeprint', toPaper);
    window.addEventListener('afterprint', toScreen);
    return () => {
      window.removeEventListener('beforeprint', toPaper);
      window.removeEventListener('afterprint', toScreen);
      toScreen();
    };
  }, []);
}

export default function Letter() {
  usePaperColours();

  return (
    <PageColumn>
      <div className="flex flex-col gap-6 print:hidden">
        <ScreenHeader
          title="Your decision letter"
          eyebrow={`${round.programme}, ${round.name}`}
          breadcrumbs={[
            { label: 'Your applications', to: '/applications' },
            { label: application.project, to: '/outcome' },
            { label: 'Decision letter' },
          ]}
        >
          <p>
            This is the letter we sent you on {decisionSent}. You can print it, or save it as a PDF.
          </p>
        </ScreenHeader>
        <div>
          <Button
            variant="primary"
            className="w-full sm:w-auto"
            onClick={() => {
              window.print();
            }}
          >
            Print or save as PDF
          </Button>
        </div>
      </div>

      <article
        aria-label={`Decision letter for ${application.project}`}
        className="flex flex-col gap-8 rounded-lg border border-t-4 border-divider border-t-accent bg-surface p-6 text-body text-ink shadow-(--shadow-raised) sm:p-10 print:rounded-none print:border-x-0 print:border-b-0 print:p-0 print:pt-8 print:shadow-none"
      >
        <div className="flex flex-col gap-1 border-b border-divider pb-6">
          <p className="text-2xl font-semibold tracking-tight">{funder.name}</p>
          <p className="text-muted">{round.programme}</p>
          <p className="text-sm text-muted">
            <ContactLine email={funder.email} phone={funder.phone} />
          </p>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
          <p>
            {[applicant.name, applicant.organisation, ...applicant.address.split(', ')].map(
              (line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ),
            )}
          </p>
          <dl className="flex flex-col gap-3 sm:text-end">
            <div>
              <dt className="text-sm font-medium text-muted">Date</dt>
              <dd>{decisionSent}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted">Our reference</dt>
              <dd className="tabular-nums">{application.reference}</dd>
            </div>
          </dl>
        </div>

        <div className="flex max-w-prose flex-col gap-4">
          <p>Dear {applicant.name},</p>
          <p className="font-semibold">Your grant for {application.project}</p>
          <p>
            We are pleased to tell you that your application to {round.programme}, {round.name} was
            successful. {funder.name} will give {applicant.organisation}{' '}
            {pounds(application.requested)} for {application.project}. You asked for{' '}
            {pounds(application.requested)}, and we are funding all of it.
          </p>
          <p>{note}</p>
          <p>Your grant runs from {grantPeriod}.</p>
        </div>

        <Section title="Conditions of your grant" className="print:break-inside-avoid">
          <p className="max-w-prose">
            These come with the grant. Please accept them by {acceptBy}.
          </p>
          <ol className="flex max-w-prose list-decimal flex-col gap-3 pl-6 marker:font-medium marker:text-muted">
            {conditions.map((condition) => (
              <li key={condition} className="pl-1">
                {condition}
              </li>
            ))}
          </ol>
        </Section>

        <Section title="What happens next" className="print:break-inside-avoid">
          <Steps steps={steps} />
        </Section>

        <div className="flex max-w-prose flex-col gap-6 print:break-inside-avoid">
          <p>
            If you have any questions, contact {caseOfficer.name}:{' '}
            <ContactLine email={funder.email} phone={funder.phone} />. We answer {caseOfficer.hours}
            .
          </p>
          <div className="flex flex-col gap-4">
            <p>Yours sincerely,</p>
            <p>
              <span className="block font-semibold">{caseOfficer.name}</span>
              <span className="block text-muted">
                {caseOfficer.role}, {funder.name}
              </span>
            </p>
          </div>
        </div>
      </article>

      <div className="print:hidden">
        <Link to="/outcome" className="inline-flex min-h-control items-center">
          Back to your outcome
        </Link>
      </div>
    </PageColumn>
  );
}
