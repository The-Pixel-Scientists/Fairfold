// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, DataTable, Panel, Stats, Tag } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { ChartPanel } from './ChartPanel.tsx';
import { HorizontalBars } from './charts/HorizontalBars.tsx';
import {
  applications,
  totalAwarded,
  hiddenCounts,
  overallRate,
  questions,
  rate,
  share,
} from './equalityData.ts';
import type { Group, Question } from './equalityData.ts';
import { FEWER_THAN_5, safeCount } from './format.ts';
import { InsightFrame } from './InsightFrame.tsx';

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** The sentence under each chart's title: what stands out, with its numbers. */
function takeaway(question: Question): string {
  if (question.id === 'benefit') {
    const group = question.groups[0];
    if (!group) return '';
    return `Projects for ${lowerFirst(group.label)} took ${String(share(group.awarded, totalAwarded))}% of the awards from ${String(share(group.applied, applications))}% of applications.`;
  }
  const best = question.groups
    .filter((group) => rate(group) !== null)
    .sort((a, b) => (rate(b) ?? 0) - (rate(a) ?? 0))[0];
  return best
    ? `Groups ${lowerFirst(best.label)} had the highest rate awarded: ${String(rate(best))}%, against ${String(overallRate)}% overall.`
    : '';
}

const percentText = (value: number | null) => (value === null ? FEWER_THAN_5 : `${String(value)}%`);

const columns: readonly Column<Group>[] = [
  { key: 'group', header: 'Group', rowHeader: true, cell: (group) => group.label },
  { key: 'applied', header: 'Applied', align: 'end', cell: (group) => safeCount(group.applied) },
  {
    key: 'appliedShare',
    header: 'Share of applications',
    align: 'end',
    cell: (group) => percentText(share(group.applied, applications)),
  },
  {
    key: 'awarded',
    header: 'Awarded',
    align: 'end',
    cell: (group) => safeCount(group.awarded),
  },
  {
    key: 'awardedShare',
    header: 'Share awarded',
    align: 'end',
    cell: (group) => percentText(share(group.awarded, totalAwarded)),
  },
  {
    key: 'rate',
    header: 'Rate awarded',
    align: 'end',
    cell: (group) => {
      const value = rate(group);
      return value === null ? <span className="text-muted">Not shown</span> : `${String(value)}%`;
    },
  },
];

function QuestionChart({ question }: { question: Question }) {
  return (
    <ChartPanel
      title={question.title}
      takeaway={takeaway(question)}
      summary={`Paired bars for ${String(question.groups.length)} answers to the question "${question.prompt}" Each shows how many applied and how many were awarded. Counts under 5 are not shown.`}
      footnote={`Counts, with each group's share of all ${String(applications)} applications and of all ${String(totalAwarded)} awarded. People could choose all that apply, so groups overlap and shares do not add up to 100%.`}
      numbers={
        <DataTable
          caption={`Applications and awards by answer to "${question.title}"`}
          captionHidden
          columns={columns}
          rows={question.groups}
          rowKey={(group) => group.id}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Question asked: <span className="text-ink">{question.prompt}</span>
        </p>
        <HorizontalBars
          series={[
            { name: 'Applied', fill: 'fill-edge' },
            { name: 'Awarded', fill: 'fill-accent' },
          ]}
          noteHeading="Rate awarded"
          max={60}
          rows={question.groups.map((group) => {
            const applied = share(group.applied, applications);
            const awardedShare = share(group.awarded, totalAwarded);
            const groupRate = rate(group);
            return {
              key: group.id,
              label: <span className="font-medium">{group.label}</span>,
              note: (
                <>
                  <span className="mr-1.5 @sm:hidden">Rate awarded</span>
                  {groupRate === null ? (
                    <span className="text-sm text-muted italic">Not shown</span>
                  ) : (
                    <span className="text-lg font-semibold text-ink">{`${String(groupRate)}%`}</span>
                  )}
                </>
              ),
              values: [
                applied === null
                  ? { value: null, text: FEWER_THAN_5 }
                  : { value: applied, text: `${String(group.applied)} (${String(applied)}%)` },
                awardedShare === null
                  ? { value: null, text: FEWER_THAN_5 }
                  : {
                      value: awardedShare,
                      text: `${String(group.awarded)} (${String(awardedShare)}%)`,
                    },
              ],
            };
          })}
        />
      </div>
    </ChartPanel>
  );
}

export default function Equality() {
  return (
    <InsightFrame
      title="Equality monitoring"
      description="Who applied and who was awarded funding in Spring 2027, from the optional equality questions. These are totals only: nobody's own answers are shown."
      actions={<Button>Export totals as CSV</Button>}
    >
      <Stats
        label="Equality monitoring summary"
        items={[
          {
            label: 'Applications',
            value: applications,
            detail: 'Every applicant saw the questions',
          },
          { label: 'Awarded', value: totalAwarded, detail: 'Released 1 April 2027' },
          {
            label: 'Rate awarded overall',
            value: `${String(overallRate)}%`,
            detail: `${String(totalAwarded)} of ${String(applications)}`,
          },
          { label: 'Counts hidden', value: hiddenCounts, detail: 'Each one is under 5' },
        ]}
      />

      <Panel
        title="Staff and reviewers never see anyone's answers"
        actions={<Tag>Totals only</Tag>}
      >
        <dl className="grid gap-x-8 gap-y-4 md:grid-cols-3">
          {[
            [
              'Kept apart',
              'Applicants answer in a section of their own. The answers are stored apart from the application and are never shown beside it.',
            ],
            [
              'Totals only',
              'These totals are the only place the answers appear. Reviewers do not see them at all, and staff cannot open them one by one.',
            ],
            [
              'Small numbers hidden',
              `A count under 5 shows as “${FEWER_THAN_5}” and is left out of percentages and rates, so no one can be picked out.`,
            ],
          ].map(([term, detail]) => (
            <div key={term} className="flex flex-col gap-1">
              <dt className="text-body font-semibold text-ink">{term}</dt>
              <dd className="text-body text-muted">{detail}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {questions.map((question) => (
        <QuestionChart key={question.id} question={question} />
      ))}
    </InsightFrame>
  );
}
