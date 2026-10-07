// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The tabs of the round page besides Overview: a read-only view of each part
// of the round's set-up, with a way into its editor.

import { Button, buttonClassName, DataTable, Link, SummaryList } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { staff } from '../story.ts';
import { emails, roundSettings, springRound, stages } from './data.ts';
import type { Stage } from './data.ts';
import { formSections, formVersion } from './formData.ts';
import type { FormSection } from './formData.ts';
import { rubric, rubricVersion, TOTAL_WEIGHT } from './rubricData.ts';
import type { RubricCriterion } from './rubricData.ts';

const ROUND = '/programmes/community-grants/spring-2027';

/** Wrapping text in a table cell, which does not wrap by itself. */
const Wrap = ({ children }: { children: ReactNode }) => (
  <span className="block min-w-56 max-w-80 whitespace-normal">{children}</span>
);

function TabIntro({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex max-w-prose flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        <p className="text-body text-muted">{children}</p>
      </div>
      {action}
    </div>
  );
}

const stageColumns: readonly Column<Stage>[] = [
  { key: 'stage', header: 'Stage', rowHeader: true, cell: (stage) => stage.name },
  { key: 'what', header: 'What happens', cell: (stage) => <Wrap>{stage.purpose}</Wrap> },
  { key: 'who', header: 'Who works on it', cell: (stage) => <Wrap>{stage.who}</Wrap> },
  { key: 'exit', header: 'Moves on when', cell: (stage) => <Wrap>{stage.exit}</Wrap> },
  { key: 'now', header: 'Reached this stage', align: 'end', cell: (stage) => stage.count },
];

export function StagesTab() {
  return (
    <div className="flex flex-col gap-4">
      <TabIntro title="Stages" action={<Button>Edit stages</Button>}>
        Every application moves through these four stages in order. A person moves it on; nothing is
        decided automatically.
      </TabIntro>
      <DataTable
        caption="Stages in this round"
        captionHidden
        columns={stageColumns}
        rows={stages}
        rowKey={(stage) => stage.id}
      />
    </div>
  );
}

const rubricColumns: readonly Column<RubricCriterion>[] = [
  { key: 'criterion', header: 'Criterion', rowHeader: true, cell: (item) => item.label },
  { key: 'weight', header: 'Weight', align: 'end', cell: (item) => item.weight },
  {
    key: 'guidance',
    header: 'What reviewers look for',
    cell: (item) => <Wrap>{item.guidance}</Wrap>,
  },
];

export function RubricTab() {
  return (
    <div className="flex flex-col gap-4">
      <TabIntro
        title="Rubric"
        action={
          <Link to={`${ROUND}/rubric`} className={buttonClassName('secondary')}>
            Edit rubric
          </Link>
        }
      >
        Version {rubricVersion.number}, saved {rubricVersion.saved}. Reviewers score each
        application from 1 (Weak) to 5 (Strong) on {rubric.length} criteria. The weights add up to{' '}
        {TOTAL_WEIGHT}.
      </TabIntro>
      <DataTable
        caption="Criteria and weights"
        captionHidden
        columns={rubricColumns}
        rows={rubric}
        rowKey={(item) => item.id}
      />
    </div>
  );
}

const formColumns: readonly Column<FormSection>[] = [
  { key: 'section', header: 'Section', rowHeader: true, cell: (section) => section.title },
  {
    key: 'questions',
    header: 'Questions',
    align: 'end',
    cell: (section) => section.questions.length,
  },
  {
    key: 'required',
    header: 'Required',
    align: 'end',
    cell: (section) => section.questions.filter((question) => question.required).length,
  },
  {
    key: 'hidden',
    header: 'Hidden from reviewers',
    align: 'end',
    cell: (section) =>
      section.questions.filter((question) => question.visibility !== 'everyone').length,
  },
];

export function FormTab() {
  return (
    <div className="flex flex-col gap-4">
      <TabIntro
        title="Application form"
        action={
          <Link to={`${ROUND}/form`} className={buttonClassName('secondary')}>
            Open form builder
          </Link>
        }
      >
        Version {formVersion.number}, published {formVersion.published}. The{' '}
        {springRound.applications} submitted applications keep this version, whatever you change
        next.
      </TabIntro>
      <DataTable
        caption="Sections of the form"
        captionHidden
        columns={formColumns}
        rows={formSections}
        rowKey={(section) => section.id}
      />
    </div>
  );
}

type Email = (typeof emails)[number];

export function EmailsTab() {
  const [sent, setSent] = useState('');

  const emailColumns: readonly Column<Email>[] = [
    { key: 'email', header: 'Email', rowHeader: true, cell: (email) => email.name },
    { key: 'to', header: 'Sent to', cell: (email) => email.to },
    { key: 'when', header: 'Sent when', cell: (email) => email.when },
    {
      key: 'version',
      header: 'Version',
      cell: (email) => `Version ${String(email.version)}, ${email.changed}`,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (email) => (
        <span className="flex justify-end gap-1">
          <Button variant="quiet">
            Edit<span className="sr-only"> {email.name}</span>
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setSent(email.name);
            }}
          >
            Send a test<span className="sr-only"> of {email.name}</span>
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <TabIntro title="Emails">
        The messages this round sends. Decision emails are held until you release decisions, so no
        applicant hears an outcome early.
      </TabIntro>
      <p role="status" className={sent === '' ? 'sr-only' : 'text-sm text-muted'}>
        {sent !== '' && `A test of “${sent}” was sent to you at ${staff.email}.`}
      </p>
      <DataTable
        caption="Emails this round sends"
        captionHidden
        columns={emailColumns}
        rows={emails}
        rowKey={(email) => email.name}
      />
    </div>
  );
}

export function SettingsTab() {
  return (
    <div className="flex flex-col gap-4">
      <TabIntro title="Settings" action={<Button>Edit settings</Button>}>
        How this round runs. Each change is saved as a version in the programme’s configuration
        history.
      </TabIntro>
      <div className="max-w-4xl">
        <SummaryList items={roundSettings} />
      </div>
    </div>
  );
}
