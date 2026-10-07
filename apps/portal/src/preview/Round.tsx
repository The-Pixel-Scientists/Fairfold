// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of the round page: what the fund is for, who can apply, how much,
// the deadline and what to have ready, before anyone spends time on it.

import { Link, Tag, buttonClassName } from '@pixel-scientists/ui';

import { PageColumn } from '../PageColumn.tsx';
import { documents } from './journey.ts';
import { ContactLine, DocumentIcon, MarkedList, ScreenHeader, Section } from './parts.tsx';
import { applicant, caseOfficer, funder, pounds, round } from './story.ts';

const canApply = [
  'You are a registered charity, a community interest company, or a community group with a written constitution.',
  'Your group, or your project, is in Northfield or the villages around it.',
  'Your project will start on or after 1 June 2027.',
  'Your project brings people together, and anyone who lives nearby can take part.',
];

const cannotApply = [
  'You are a school, a council or an NHS body.',
  'The money would pay for something that has already happened.',
  'The project would make a profit for owners or shareholders.',
  'You have a report overdue on an earlier grant from us.',
];

/** The documents say the same here as on the documents screen. */
const youWillNeed = [
  ...documents.map(({ label, hint }) => ({ title: label, text: hint })),
  {
    title: 'A budget for the project',
    text: 'A list of what it will cost. You will type it into a table, so work it out first.',
  },
];

/** The round's front page. It answers "is this for me?" before the applicant starts. */
export default function Round() {
  return (
    <PageColumn>
      <ScreenHeader title={round.programme} eyebrow={`${funder.name}, ${round.name}`}>
        <p>{round.summary}</p>
      </ScreenHeader>

      <div className="flex flex-col gap-1.5 border-y border-divider py-6">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-muted">
          <Tag tone="info">Open</Tag>
          Applications close
        </p>
        <p className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          <time dateTime="2027-03-03T17:00">{round.closes}</time>
        </p>
        <p className="max-w-prose text-body text-muted">
          UK time. You can start now, stop whenever you like and come back before then. We will tell
          you our decision by {round.decisionsBy}.
        </p>
      </div>

      <Section title="What the fund is for">
        <p className="max-w-prose text-body text-ink">
          Community Grants help people in Northfield and the villages around it meet, learn and look
          after each other. We pay for the everyday costs of a project: hall hire, food, travel, a
          part-time worker, small equipment and training for volunteers.
        </p>
      </Section>

      <Section title="Who can apply">
        <div className="flex flex-col gap-4">
          <h3 className="text-body font-semibold text-ink">You can apply if:</h3>
          <MarkedList mark="yes" items={canApply} />
        </div>
        <div className="flex flex-col gap-4 border-t border-divider pt-6">
          <h3 className="text-body font-semibold text-ink">You cannot apply if:</h3>
          <MarkedList mark="no" items={cannotApply} />
        </div>
        <p className="max-w-prose rounded-lg bg-sunken p-4 text-body text-ink">
          Not sure? Start the application. We ask a few short questions first. If you cannot apply,
          we tell you why before you write anything else.
        </p>
      </Section>

      <Section title="How much you can ask for">
        <p className="text-2xl font-semibold tracking-tight text-ink tabular-nums">
          {pounds(round.minimumAward)} to {pounds(round.maximumAward)}
        </p>
        <p className="max-w-prose text-body text-ink">
          Ask for what the project needs, not the most you can. You can ask for part of the cost.
          Tell us about any other money you have, and we will take it into account. We pay for up to
          12 months.
        </p>
      </Section>

      <Section title="Before you start">
        <p className="max-w-prose text-body text-ink">
          It takes about an hour. We save your answers as you go, so you can stop and come back
          whenever you need to. Have these ready. The three documents can be PDF or Word files, up
          to 10 MB each.
        </p>
        <ul role="list" className="divide-y divide-divider border-y border-divider">
          {youWillNeed.map((item) => (
            <li key={item.title} className="flex items-start gap-4 py-4">
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-md bg-sunken text-muted"
              >
                <DocumentIcon className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col">
                <p className="font-semibold text-ink">{item.title}</p>
                <p className="text-body text-muted">{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <div className="flex flex-col gap-4">
        <div>
          <Link to="/application" className={buttonClassName('primary', 'w-full sm:w-auto')}>
            Start application
          </Link>
        </div>
        <p className="max-w-prose text-body text-muted">
          We save your answers to your account, {applicant.email}.
        </p>
        <p className="max-w-prose text-body text-muted">
          Questions before you start? Contact {caseOfficer.name} at{' '}
          <ContactLine email={funder.email} phone={funder.phone} />. We answer {caseOfficer.hours}.
        </p>
      </div>
    </PageColumn>
  );
}
