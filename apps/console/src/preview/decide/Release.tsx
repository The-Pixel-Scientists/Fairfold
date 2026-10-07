// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Design preview: Release decisions. What will be sent, one email as an
// applicant will read it, a confirmation, and the step-up check that proves
// it is a named person acting (rules 8 and 9).

import {
  Button,
  CheckboxGroup,
  FormField,
  Link,
  PageHeader,
  Panel,
  Select,
  Stats,
  StepUpDialog,
  SummaryList,
  Tag,
  buttonClassName,
} from '@pixel-scientists/ui';
import { Fragment, useEffect, useRef, useState } from 'react';

import { emails as templates } from '../setup/data.ts';
import { applications, funder, pounds, staff } from '../story.ts';
import { awards, awardedTotal, budget, candidates, total } from './decisions-data.ts';
import type { Outcome } from './decisions-data.ts';
import { checkIdentity } from './identity.ts';
import { Eyebrow, Icon, Notice } from './parts.tsx';

/** Words, or a word the email fills in for each applicant. */
type Part = string | { fill: string };

interface Email {
  label: string;
  to: string;
  subject: string;
  paragraphs: readonly (readonly Part[])[];
}

const signOff: readonly Part[][] = [
  [`If you have a question, reply to this email or call ${staff.name} on ${funder.phone}.`],
  ['With best wishes,'],
];

const emails: Record<Outcome, Email> = {
  Accept: {
    label: 'Awarded: Riverside Lunch Club',
    to: 'Sam Patel <sam@example.org>',
    subject: 'Your Community Grants application NF-CG-0412',
    paragraphs: [
      ['Dear ', { fill: 'Sam' }, ','],
      [
        'Thank you for applying to ',
        { fill: 'Community Grants, Spring 2027' },
        '. We are pleased to tell you that your application for ',
        { fill: 'Riverside Lunch Club' },
        ' (reference ',
        { fill: 'NF-CG-0412' },
        ') was successful. We have awarded you ',
        { fill: '£12,500' },
        '.',
      ],
      [
        'Sign in to read the conditions of the grant and what happens next. We ask you to accept them within 28 days.',
      ],
      ...signOff,
    ],
  },
  Waitlist: {
    label: 'Waitlisted: Accessible toilets and ramp',
    to: 'Joan Whitcombe <office@sandfordvillagehall.example>',
    subject: 'Your Community Grants application NF-CG-0418',
    paragraphs: [
      ['Dear ', { fill: 'Joan' }, ','],
      [
        'Thank you for applying to ',
        { fill: 'Community Grants, Spring 2027' },
        ' for ',
        { fill: 'Accessible toilets and ramp' },
        ' (reference ',
        { fill: 'NF-CG-0418' },
        ').',
      ],
      [
        'We cannot offer you a grant yet. If funds are freed up, we will write to you by ',
        { fill: '30 June 2027' },
        '.',
      ],
      ['You do not need to do anything now. Sign in to read the panel’s feedback.'],
      ...signOff,
    ],
  },
  Decline: {
    label: 'Declined: Lantern parade 2027',
    to: 'Rhys Evans <hello@lanternarts.example>',
    subject: 'Your Community Grants application NF-CG-0402',
    paragraphs: [
      ['Dear ', { fill: 'Rhys' }, ','],
      [
        'Thank you for applying to ',
        { fill: 'Community Grants, Spring 2027' },
        ' for ',
        { fill: 'Lantern parade 2027' },
        ' (reference ',
        { fill: 'NF-CG-0402' },
        ').',
      ],
      [
        'We received ',
        { fill: String(candidates.length) },
        ' eligible applications asking for ',
        { fill: pounds(total(candidates.map((item) => item.requested))) },
        ', and we had ',
        { fill: pounds(budget) },
        ' to give. We are sorry that we could not fund yours this time.',
      ],
      [
        'Sign in to read the panel’s feedback. Our Summer 2027 round opens on 1 June 2027, and you are welcome to apply again.',
      ],
      ...signOff,
    ],
  },
};

const checks = [
  `All ${String(candidates.length)} eligible applications have a recorded decision.`,
  `The ${String(awards.length)} recommended awards add up to ${pounds(awardedTotal)}, within the ${pounds(budget)} budget.`,
  'Every application recommended for an award has a main contact with an email address.',
  `The ${String(applications.length - candidates.length)} ineligible applicants were told on 8 March 2027, so they get no email now.`,
];

const confirmId = 'confirm-release';

const counts = (outcome: Outcome) => candidates.filter((item) => item.outcome === outcome);

function EmailPreview({ email }: { email: Email }) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-body sm:grid-cols-[4.5rem_minmax(0,1fr)]">
        <dt className="text-sm font-medium text-muted">To</dt>
        <dd className="break-words">{email.to}</dd>
        <dt className="text-sm font-medium text-muted">From</dt>
        <dd className="break-words">
          {funder.name} &lt;{funder.email}&gt;
        </dd>
        <dt className="text-sm font-medium text-muted">Subject</dt>
        <dd className="font-medium break-words">{email.subject}</dd>
      </dl>
      <hr className="border-divider" />
      <div className="flex max-w-prose flex-col gap-3 text-body">
        {email.paragraphs.map((parts, index) => (
          <p key={index}>
            {parts.map((part, position) =>
              typeof part === 'string' ? (
                <Fragment key={position}>{part}</Fragment>
              ) : (
                <span
                  key={position}
                  className="-mx-0.5 rounded-sm bg-accent-soft px-0.5 font-medium"
                >
                  {part.fill}
                </span>
              ),
            )}
          </p>
        ))}
        <p>
          <span className="font-medium">{staff.name}</span>
          <br />
          <span className="text-muted">
            {staff.role}, {funder.name}
          </span>
        </p>
      </div>
    </div>
  );
}

export default function Release() {
  const [preview, setPreview] = useState<Outcome>('Accept');
  const [confirmed, setConfirmed] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [asking, setAsking] = useState(false);
  const [released, setReleased] = useState(false);
  const done = useRef<HTMLDivElement>(null);
  const recipients = candidates.length;

  // The Release decisions button goes once the decisions are out, so move focus to what replaces it.
  useEffect(() => {
    if (released) done.current?.focus();
  }, [released]);

  const release = (
    <Button
      variant="primary"
      onClick={() => {
        if (confirmed) {
          setAsking(true);
          return;
        }
        setUnconfirmed(true);
        document.getElementById(confirmId)?.focus();
      }}
    >
      Release decisions
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        breadcrumbs={[
          { label: 'Programmes', to: '/programmes' },
          { label: 'Community Grants', to: '/programmes/community-grants' },
          { label: 'Spring 2027', to: '/programmes/community-grants/spring-2027' },
          { label: 'Decisions', to: '/decisions' },
          { label: 'Release decisions' },
        ]}
        eyebrow={
          <Eyebrow>
            {released ? <Tag tone="success">Complete</Tag> : <Tag tone="info">Deciding</Tag>}
            <span>Community Grants, Spring 2027</span>
          </Eyebrow>
        }
        title="Release decisions"
        description={
          released
            ? 'Every applicant has been told their outcome.'
            : 'Check what each applicant will be told. Every decision is private to staff until you confirm.'
        }
      />

      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-8">
          <section aria-labelledby="happens" className="flex flex-col gap-3">
            <h2 id="happens" className="text-lg font-semibold tracking-tight text-ink">
              What will happen
            </h2>
            <Stats
              label="Decisions to release"
              items={[
                {
                  label: released ? 'Awarded' : 'Recommended',
                  value: pounds(awardedTotal),
                  detail: `to ${String(awards.length)} applications`,
                },
                {
                  label: 'Waitlisted',
                  value: counts('Waitlist').length,
                  detail: 'told they may hear again',
                },
                {
                  label: 'Declined',
                  value: counts('Decline').length,
                  detail: 'with feedback to read',
                },
                { label: 'Emails', value: recipients, detail: 'one to each applicant' },
              ]}
            />
          </section>

          <section aria-labelledby="checks" className="flex flex-col gap-3">
            <h2 id="checks" className="text-lg font-semibold tracking-tight text-ink">
              Checks passed
            </h2>
            <ul className="flex flex-col divide-y divide-divider text-body">
              {checks.map((text) => (
                <li key={text} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                  <Icon name="check" className="mt-1 text-success" />
                  <span>
                    <span className="sr-only">Passed: </span>
                    {text}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="sent" className="flex flex-col gap-3">
            <h2 id="sent" className="text-lg font-semibold tracking-tight text-ink">
              How it is sent
            </h2>
            <SummaryList
              items={[
                { term: 'Sent', value: 'Straight after you confirm' },
                {
                  term: 'Templates',
                  value: templates
                    .filter((template) => template.name.startsWith('Decision'))
                    .map((template) => `${template.name} (version ${String(template.version)})`)
                    .join(', '),
                },
                {
                  term: 'Applicants see',
                  value: 'Their outcome when they sign in, and the panel’s feedback',
                },
                {
                  term: 'Afterwards',
                  value:
                    'A change to a decision is written to the audit log and the applicant is told',
                },
              ]}
            />
          </section>
        </div>

        <Panel title="Email preview" className="self-start">
          <FormField
            label="Preview the email for"
            hint="Each applicant gets the email for their decision."
          >
            <Select
              value={preview}
              onChange={(event) => {
                setPreview(event.currentTarget.value as Outcome);
              }}
            >
              {(Object.keys(emails) as Outcome[]).map((outcome) => (
                <option key={outcome} value={outcome}>
                  {emails[outcome].label}
                </option>
              ))}
            </Select>
          </FormField>
          <EmailPreview email={emails[preview]} />
          <p className="text-sm text-muted">
            Highlighted words are filled in for each applicant from their application and the round.
          </p>
        </Panel>
      </div>

      <div className="border-t border-divider pt-6">
        {released ? (
          <div ref={done} tabIndex={-1} role="status" className="rounded-lg">
            <Notice
              tone="success"
              icon="check"
              title="Decisions released"
              action={
                <div className="flex flex-wrap gap-2">
                  <Link to="/decisions" className={buttonClassName('secondary')}>
                    Back to decisions
                  </Link>
                  <Link to="/reports" className={buttonClassName('secondary')}>
                    Open reports
                  </Link>
                </div>
              }
            >
              {recipients} emails are on their way. Applicants see their outcome when they sign in.
            </Notice>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <CheckboxGroup
              className="max-w-prose"
              legend="Before you release"
              id={confirmId}
              name="confirm"
              values={confirmed ? ['confirmed'] : []}
              onValuesChange={(values) => {
                setConfirmed(values.includes('confirmed'));
                setUnconfirmed(false);
              }}
              hint="You will be asked to confirm it is you."
              error={
                unconfirmed && !confirmed
                  ? 'Tick the box to confirm you have checked the summary and the email.'
                  : undefined
              }
              options={[
                {
                  value: 'confirmed',
                  label: `I have checked the summary and the email. I understand that all ${String(recipients)} applicants are told as soon as I confirm.`,
                },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Link to="/decisions" className={buttonClassName('quiet')}>
                Back to decisions
              </Link>
              {release}
            </div>
          </div>
        )}
      </div>

      <StepUpDialog
        open={asking && !released}
        onOpenChange={(open) => {
          setAsking(open);
          if (!open) setConfirmed(false);
        }}
        onConfirm={async (credentials) => {
          checkIdentity(credentials);
          await Promise.resolve();
          setReleased(true);
        }}
      />
    </div>
  );
}
