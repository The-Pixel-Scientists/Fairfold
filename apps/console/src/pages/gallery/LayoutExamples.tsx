// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Breadcrumbs,
  Button,
  Link,
  Meter,
  PageHeader,
  Panel,
  Stats,
  SummaryList,
  Tag,
} from '@pixel-scientists/ui';
import type { TagTone } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      {children}
    </div>
  );
}

/**
 * Shows what a page may hold only once, a heading level 1 and the breadcrumb
 * navigation, without a second copy on the gallery page. It is for looking at:
 * hidden from assistive technology and inert. The unit tests cover the markup.
 */
function VisualOnly({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden="true" inert>
      {children}
    </div>
  );
}

const states: readonly [string, readonly [TagTone, string][]][] = [
  [
    'Application',
    [
      ['neutral', 'Draft'],
      ['info', 'Submitted'],
      ['danger', 'Ineligible'],
      ['info', 'In review'],
      ['info', 'Shortlisted'],
      ['success', 'Awarded'],
      ['warning', 'Waitlisted'],
      ['danger', 'Declined'],
      ['neutral', 'Withdrawn'],
    ],
  ],
  [
    'Review',
    [
      ['neutral', 'Not started'],
      ['info', 'In progress'],
      ['success', 'Submitted'],
      ['warning', 'Conflict declared'],
    ],
  ],
  [
    'Decision',
    [
      ['neutral', 'Not recorded'],
      ['info', 'Recorded (private)'],
      ['success', 'Released'],
    ],
  ],
];

function Activity() {
  return (
    <ul className="flex flex-col divide-y divide-divider text-sm">
      {[
        ['Application submitted', '28 March 2027'],
        ['Eligibility checks passed', '29 March 2027'],
        ['Three reviewers assigned', '1 April 2027'],
      ].map(([event, date]) => (
        <li
          key={event}
          className="flex flex-wrap justify-between gap-x-4 py-2 first:pt-0 last:pb-0"
        >
          <span className="text-ink">{event}</span>
          <span className="text-muted">{date}</span>
        </li>
      ))}
    </ul>
  );
}

const change = (what: string) => (
  <Link to="/">
    Change<span className="sr-only"> {what}</span>
  </Link>
);

/** Page structure: headers, breadcrumbs, tags, panels, summaries, stats and meters. */
export function LayoutExamples() {
  return (
    <>
      <Section title="Page header">
        <VisualOnly>
          <div className="flex flex-col gap-6">
            <PageHeader
              breadcrumbs={[{ label: 'Programmes', to: '/' }, { label: 'Community Grants 2027' }]}
              eyebrow={
                <>
                  <Tag tone="info">Open</Tag>
                  <span>Spring 2027</span>
                </>
              }
              title="Community Grants 2027"
              description="Grants of £5,000 to £25,000 for community projects. Applications close on 30 April 2027 at 5pm."
              actions={
                <>
                  <Button>Copy applicant link</Button>
                  <Button variant="primary">Add reviewer</Button>
                </>
              }
            />
            <hr className="border-divider" />
            <PageHeader
              title="Applications"
              description="Everything received for Spring 2027, with what needs doing next."
            />
          </div>
        </VisualOnly>
      </Section>

      <Section title="Breadcrumbs">
        <VisualOnly>
          <Breadcrumbs
            items={[
              { label: 'Programmes', to: '/' },
              { label: 'Community Grants 2027', to: '/' },
              { label: 'Applications', to: '/' },
              { label: 'Eastmere Community Hub: weekend repair café' },
            ]}
          />
        </VisualOnly>
      </Section>

      <Section title="Tags">
        <div className="flex flex-col gap-3">
          {states.map(([name, tags]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-muted">{name}</p>
              <div className="flex flex-wrap gap-2">
                {tags.map(([tone, label]) => (
                  <Tag key={label} tone={tone}>
                    {label}
                  </Tag>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Panel">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">On the canvas</p>
            <Panel
              title="Activity"
              headingLevel="h3"
              actions={<Button variant="quiet">Add note</Button>}
            >
              <Activity />
            </Panel>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">Inside the console sheet</p>
            <div className="rounded-lg border border-divider bg-surface p-4 shadow-(--shadow-raised)">
              <Panel title="Activity log" headingLevel="h3">
                <Activity />
              </Panel>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Summary list">
        <Panel title="Application details" headingLevel="h3">
          <SummaryList
            items={[
              { term: 'Organisation', value: 'Eastmere Community Hub' },
              { term: 'Project', value: 'Weekend repair café' },
              { term: 'Amount requested', value: '£18,500' },
              { term: 'Stage', value: <Tag tone="info">In review</Tag>, action: change('stage') },
              { term: 'Submitted', value: '28 March 2027' },
              {
                term: 'Contact',
                value: 'Amara Okafor, amara.okafor@eastmerehub.example',
                action: change('contact'),
              },
            ]}
          />
        </Panel>
      </Section>

      <Section title="Stats">
        <Stats
          label="Spring 2027 round"
          items={[
            { label: 'Applications received', value: '48', detail: '12 in the last week' },
            { label: 'Total requested', value: '£612,400', detail: 'Average £12,758' },
            { label: 'Budget', value: '£250,000', detail: 'Requests are 2.4 times the budget' },
            { label: 'Reviews done', value: '31', detail: 'of 96 assigned' },
          ]}
        />
      </Section>

      <Section title="Meters">
        <Panel title="Round progress" headingLevel="h3">
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            <Meter label="Average score" value={3.8} max={5} valueText="3.8 of 5" />
            <Meter label="Reviews done" value={31} max={96} valueText="31 of 96" />
            <Meter
              label="Budget committed"
              value={187_500}
              max={250_000}
              valueText="£187,500 of £250,000"
              tone="warning"
            />
            <Meter
              label="Eligibility checks"
              value={48}
              max={48}
              valueText="48 of 48 passed"
              tone="success"
            />
            <Meter
              label="Spring bursary committed"
              value={262_000}
              max={250_000}
              valueText="£262,000 of £250,000, over by £12,000"
              tone="danger"
            />
          </div>
        </Panel>
      </Section>
    </>
  );
}
