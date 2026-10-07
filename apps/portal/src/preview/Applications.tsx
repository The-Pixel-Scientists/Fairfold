// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Preview of the signed-in applicant's list: one draft to finish, one
// application sent, one with a released decision. An applicant sees only
// Draft, Submitted or a decision that has been released. Whatever stage a
// sent application has reached inside the funder stays private.

import { Button, Link, Tag, buttonClassName, cx } from '@pixel-scientists/ui';
import type { TagTone } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { PageColumn } from '../PageColumn.tsx';
import { ScreenHeader, Section } from './parts.tsx';
import { application, pounds, round } from './story.ts';

interface Entry {
  id: string;
  project: string;
  fund: string;
  status: { words: string; tone: TagTone };
  facts: readonly (readonly [string, string])[];
  note: string;
  action?: ReactNode;
}

/** Keeps a date on one line, so it never splits between the day and the month. */
const date = (text: string) => text.replaceAll(' ', ' ');

const draft: Entry = {
  id: 'green-spaces',
  project: 'Riverside Pocket Garden',
  fund: 'Green Spaces Fund, 2027',
  status: { words: 'Draft', tone: 'neutral' },
  facts: [
    ['Sections completed', '2 of 6'],
    ['Last saved', date('20 February 2027')],
    ['Closes', `${date('26 April 2027')} at 5pm`],
  ],
  note: 'Not sent yet. Everything you have written is saved.',
};

const sent: readonly Entry[] = [
  {
    id: 'spring-2027',
    project: application.project,
    fund: `${round.programme}, ${round.name}`,
    status: { words: 'Submitted', tone: 'info' },
    facts: [
      ['Reference', application.reference],
      ['You asked for', pounds(application.requested)],
      ['Sent', date('1 March 2027')],
    ],
    note: `We will tell you our decision by ${date(round.decisionsBy)}.`,
    action: (
      <Link
        to="/application/submitted"
        className={buttonClassName('secondary', 'w-full sm:w-auto')}
      >
        See what happens next <span className="sr-only">for {application.project}</span>
      </Link>
    ),
  },
  {
    id: 'autumn-2026',
    project: 'Winter Warm Space',
    fund: 'Community Grants, Autumn 2026',
    status: { words: 'Awarded', tone: 'success' },
    facts: [
      ['Reference', 'NF-CG-0291'],
      ['Awarded', pounds(8_000)],
      ['Paid', date('16 November 2026')],
    ],
    note: `Your report is due by ${date('1 June 2027')}.`,
  },
];

function Card({ entry, children }: { entry: Entry; children?: ReactNode }) {
  return (
    <li className="flex flex-col gap-5 rounded-lg border border-divider bg-surface p-5 shadow-(--shadow-raised) sm:p-6">
      <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-muted">{entry.fund}</p>
          <h3 className="text-lg font-semibold tracking-tight text-ink">{entry.project}</h3>
        </div>
        <span>
          <Tag tone={entry.status.tone}>{entry.status.words}</Tag>
        </span>
      </div>
      <dl className="flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:gap-x-6">
        {entry.facts.map(([term, value]) => (
          <div
            key={term}
            className="flex items-baseline justify-between gap-4 sm:min-w-0 sm:flex-col sm:justify-start sm:gap-0.5"
          >
            <dt className="shrink-0 text-sm font-medium text-muted">{term}</dt>
            <dd className="text-end text-body text-ink tabular-nums sm:text-start">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-4 border-t border-divider pt-4">
        <div
          className={cx(
            'flex flex-col gap-3',
            entry.action !== undefined && 'sm:flex-row sm:items-center sm:justify-between sm:gap-6',
          )}
        >
          <p className="max-w-prose text-body text-muted">{entry.note}</p>
          {entry.action}
        </div>
        {children}
      </div>
    </li>
  );
}

/**
 * Only the Community Grants application has screens in this demo, so opening the
 * other draft says so and points to the one that does.
 */
function DraftCard() {
  const [pressed, setPressed] = useState(false);
  const action = (
    <Button
      variant="primary"
      className="w-full sm:w-auto"
      onClick={() => {
        setPressed(true);
      }}
    >
      Continue application <span className="sr-only">for {draft.project}</span>
    </Button>
  );
  return (
    <Card entry={{ ...draft, action }}>
      <div role="status" className="empty:hidden">
        {pressed && (
          <div className="flex max-w-prose flex-col items-start gap-1 rounded-lg bg-sunken p-4 text-body text-ink">
            <p>Only the {application.project} application opens in this demo.</p>
            <Link to="/application" className="inline-flex min-h-control items-center">
              Open the {application.project} application
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <ul role="list" className="flex flex-col gap-4">
        {children}
      </ul>
    </Section>
  );
}

/** Where a signed-in applicant lands: what to finish first, then what they have sent. */
export default function Applications() {
  return (
    <PageColumn>
      <ScreenHeader title="Your applications" eyebrow="Northfield Foundation">
        <p>Everything you have started or sent, in one place.</p>
      </ScreenHeader>
      <Group title="To finish">
        <DraftCard />
      </Group>
      <Group title="Sent">
        {sent.map((entry) => (
          <Card key={entry.id} entry={entry} />
        ))}
      </Group>
      <div className="border-t border-divider pt-6">
        <Link to="/round" className="inline-flex min-h-control items-center">
          See which funds are open
        </Link>
      </div>
    </PageColumn>
  );
}
