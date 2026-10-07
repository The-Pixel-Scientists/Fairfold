// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  buttonClassName,
  Link,
  Meter,
  PageHeader,
  Panel,
  Stats,
  SummaryList,
  Tabs,
  Tag,
} from '@pixel-scientists/ui';
import { useId, useState } from 'react';

import { figuresFor, themes } from '../insight/roundData.ts';
import { pounds } from '../story.ts';
import {
  dateOnly,
  figures,
  keyDates,
  nextToDo,
  reviewersToChase,
  reviewsToFinish,
  roundTone,
  springRound,
  stages,
} from './data.ts';
import { StagePipeline } from './StagePipeline.tsx';
import { EmailsTab, FormTab, RubricTab, SettingsTab, StagesTab } from './RoundTabs.tsx';

const { received, eligible, requested, assigned, submitted } = figures;
const { started } = figuresFor(themes);
const percent = (part: number, whole: number) => `${String(Math.round((part / whole) * 100))}%`;

function Overview() {
  const pipelineId = useId();
  return (
    <div className="flex flex-col gap-8">
      <Stats
        label="Spring 2027 at a glance"
        items={[
          {
            label: 'Applications received',
            value: received,
            detail: (
              <Meter
                label={`Submitted, of ${String(started)} started`}
                value={received}
                max={started}
                valueText={`${String(received)} of ${String(started)}`}
              />
            ),
          },
          {
            label: 'Eligible',
            value: eligible,
            detail: (
              <Meter
                label="Passed the checks"
                value={eligible}
                max={received}
                valueText={`${String(eligible)} of ${String(received)}`}
              />
            ),
          },
          {
            label: 'Amount requested',
            value: pounds(requested),
            detail: (
              <Meter
                label={`${(requested / springRound.budget).toFixed(1)} times the budget`}
                value={springRound.budget}
                max={requested}
                valueText={`${percent(springRound.budget, requested)} covered`}
                tone="warning"
              />
            ),
          },
          {
            label: 'Reviews done',
            value: `${String(submitted)} of ${String(assigned)}`,
            detail: (
              <Meter
                label={`Done, of ${String(assigned)} assigned`}
                value={submitted}
                max={assigned}
                valueText={percent(submitted, assigned)}
              />
            ),
          },
        ]}
      />
      <section aria-labelledby={pipelineId} className="flex flex-col gap-3">
        <h2 id={pipelineId} className="text-lg font-semibold tracking-tight text-ink">
          Stage pipeline
        </h2>
        <StagePipeline stages={stages} />
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title="What to do next">
          <ul role="list" className="flex flex-col divide-y divide-divider">
            {nextToDo.map((item) => (
              <li key={item.title} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <span className="font-medium text-ink">{item.title}</span>
                <span className="text-sm text-muted">{item.detail}</span>
                <Link to={item.to} className="text-sm font-medium">
                  {item.link}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Key dates">
          <SummaryList
            items={keyDates.map((item) => ({
              term: item.event,
              value: (
                <span className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span>{item.date}</span>
                  <span className="text-sm text-muted">{item.when}</span>
                </span>
              ),
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

/** One round of a programme: where its applications are, what it costs and what is next. */
export default function Round() {
  const [reminded, setReminded] = useState(false);

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        breadcrumbs={[
          { label: 'Programmes', to: '/programmes' },
          { label: 'Community Grants', to: '/programmes/community-grants' },
          { label: springRound.name },
        ]}
        eyebrow={<Tag tone="info">Design preview</Tag>}
        title={springRound.name}
        description={
          <>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Tag tone={roundTone[springRound.status]}>{springRound.status}</Tag>
              <span>
                Closed on {dateOnly(springRound.closes)}. Reviewers have {reviewsToFinish} reviews
                left to finish.
              </span>
            </span>
            <span
              role="status"
              className={reminded ? 'mt-1.5 flex items-center gap-1.5 text-success' : undefined}
            >
              {reminded && (
                <>
                  <CheckIcon />
                  Reminder sent to the {reviewersToChase} reviewers with reviews to finish.
                </>
              )}
            </span>
          </>
        }
        actions={
          <>
            <Button
              aria-disabled={reminded}
              onClick={() => {
                setReminded(true);
              }}
            >
              {reminded ? 'Reminder sent' : 'Remind reviewers'}
            </Button>
            <Link to="/submissions" className={buttonClassName('primary')}>
              View submissions
            </Link>
          </>
        }
      />
      <Tabs
        label="Round sections"
        tabs={[
          { id: 'overview', label: 'Overview', content: <Overview /> },
          { id: 'stages', label: 'Stages', content: <StagesTab /> },
          { id: 'rubric', label: 'Rubric', content: <RubricTab /> },
          { id: 'form', label: 'Form', content: <FormTab /> },
          { id: 'emails', label: 'Emails', content: <EmailsTab /> },
          { id: 'settings', label: 'Settings', content: <SettingsTab /> },
        ]}
      />
    </div>
  );
}
