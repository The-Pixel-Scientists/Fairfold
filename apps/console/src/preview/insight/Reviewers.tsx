// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  DataTable,
  Link,
  Meter,
  Panel,
  Stats,
  buttonClassName,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { criteria } from '../story.ts';
import { ChartPanel } from './ChartPanel.tsx';
import { DotPlot } from './charts/DotPlot.tsx';
import { HorizontalBars } from './charts/HorizontalBars.tsx';
import { InsightFrame } from './InsightFrame.tsx';
import { calibration, disagreement, gap, panelMean } from './reviewerData.ts';
import type { Calibration } from './reviewerData.ts';

/** A gap this size or more is marked, in words and on the chart. */
const MARKED_GAP = 0.5;

const signed = (value: number) =>
  value === 0 ? '0.0' : `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;

const caption = (reviewer: Calibration) => {
  const difference = Math.abs(gap(reviewer));
  if (difference === 0) return 'At the panel mean';
  const side = gap(reviewer) > 0 ? 'above' : 'below';
  return difference >= MARKED_GAP
    ? `${difference.toFixed(1)} ${side} the panel mean`
    : `${difference.toFixed(1)} ${side}`;
};

const byMean = [...calibration].sort((a, b) => b.mean - a.mean || a.name.localeCompare(b.name));
const marked = calibration.filter((reviewer) => Math.abs(gap(reviewer)) >= MARKED_GAP);
const submittedTotal = calibration.reduce((sum, reviewer) => sum + reviewer.submitted, 0);
const assignedTotal = calibration.reduce((sum, reviewer) => sum + reviewer.assigned, 0);
const closeToPanel = calibration.filter((reviewer) => Math.abs(gap(reviewer)) <= 0.2).length;

const columns: readonly Column<Calibration>[] = [
  { key: 'name', header: 'Reviewer', rowHeader: true, cell: (reviewer) => reviewer.name },
  {
    key: 'submitted',
    header: 'Reviews submitted',
    align: 'end',
    cell: (reviewer) => `${String(reviewer.submitted)} of ${String(reviewer.assigned)}`,
  },
  { key: 'mean', header: 'Mean score', align: 'end', cell: (reviewer) => reviewer.mean.toFixed(1) },
  {
    key: 'gap',
    header: 'Gap to the panel',
    align: 'end',
    cell: (reviewer) => signed(gap(reviewer)),
  },
  { key: 'lowest', header: 'Lowest', align: 'end', cell: (reviewer) => reviewer.lowest.toFixed(1) },
  {
    key: 'highest',
    header: 'Highest',
    align: 'end',
    cell: (reviewer) => reviewer.highest.toFixed(1),
  },
  {
    key: 'minutes',
    header: 'Median minutes',
    align: 'end',
    cell: (reviewer) => reviewer.medianMinutes,
  },
];

type Disagreement = (typeof disagreement)[number];

const top = disagreement.reduce((most, row) => (row.count > most.count ? row : most));

const weightOf = (row: Disagreement) =>
  criteria.find((criterion) => criterion.id === row.id)?.weight;

const disagreementColumns: readonly Column<Disagreement>[] = [
  { key: 'criterion', header: 'Criterion', rowHeader: true, cell: (row) => row.label },
  { key: 'weight', header: 'Weight', align: 'end', cell: weightOf },
  {
    key: 'share',
    header: 'Scores 2 or more points apart',
    align: 'end',
    cell: (row) => `${String(row.share)}%`,
  },
];

function Points({ points }: { points: readonly (readonly [string, string])[] }) {
  return (
    <dl className="flex flex-col gap-5">
      {points.map(([term, detail]) => (
        <div key={term} className="flex flex-col gap-1">
          <dt className="text-body font-semibold text-ink">{term}</dt>
          <dd className="text-body text-muted">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Reviewers() {
  return (
    <InsightFrame
      title="Reviewer calibration"
      description="How each reviewer's scores sit against the panel's, so everyone is scoring on the same scale. It is for staff to talk through with the panel, not to judge anyone."
      actions={<Button>Export scores as CSV</Button>}
    >
      <Stats
        label="Review summary"
        items={[
          { label: 'Panel mean score', value: panelMean.toFixed(1), detail: 'Weighted, out of 5' },
          {
            label: 'Reviews submitted',
            value: submittedTotal,
            detail: `of ${String(assignedTotal)} assigned`,
          },
          {
            label: 'Median time per review',
            value: '34 minutes',
            detail: 'Across all six reviewers',
          },
          {
            label: 'Close to the panel',
            value: `${String(closeToPanel)} of ${String(calibration.length)}`,
            detail: 'Reviewers within 0.2 of the mean',
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <ChartPanel
          className="lg:col-span-8"
          title="Mean score by reviewer"
          footnote="The dot is the reviewer’s mean score. The line runs from their lowest score to their highest."
          takeaway={`${marked.length === 1 ? 'One reviewer scores' : `${String(marked.length)} reviewers score`} ${marked[0] ? Math.abs(gap(marked[0])).toFixed(1) : ''} lower than the panel on average; the other ${String(calibration.length - marked.length)} are within 0.2 of it.`}
          summary={`Dot plot of each reviewer's mean weighted score, against a panel mean of ${panelMean.toFixed(1)}. ${byMean
            .map(
              (reviewer) =>
                `${reviewer.name}: ${reviewer.mean.toFixed(1)}, ${caption(reviewer)}, range ${reviewer.lowest.toFixed(1)} to ${reviewer.highest.toFixed(1)}`,
            )
            .join('. ')}.`}
          numbers={
            <DataTable
              caption="Scores by reviewer"
              captionHidden
              columns={columns}
              rows={byMean}
              rowKey={(reviewer) => reviewer.name}
            />
          }
        >
          <DotPlot
            domain={[1.5, 5]}
            ticks={[2, 3, 4, 5]}
            reference={{ value: panelMean, label: `Panel mean ${panelMean.toFixed(1)}` }}
            axis="Weighted score out of 5"
            rows={byMean.map((reviewer) => ({
              key: reviewer.name,
              value: reviewer.mean,
              low: reviewer.lowest,
              high: reviewer.highest,
              caption: caption(reviewer),
              flagged: Math.abs(gap(reviewer)) >= MARKED_GAP,
              label: (
                <>
                  <span className="font-medium">{reviewer.name}</span>
                  <span className="block text-sm text-muted tabular-nums">
                    {`${String(reviewer.submitted)} reviews · median ${String(reviewer.medianMinutes)} min`}
                  </span>
                </>
              ),
            }))}
          />
        </ChartPanel>

        <div className="flex flex-col gap-6 lg:col-span-4">
          <Panel title="How to read this" className="flex-1">
            <Points
              points={[
                [
                  'A gap is not a fault',
                  'Reviewers read different applications, so part of any gap comes from what they were given. The reviewer 0.6 below the panel scored 21 applications. The other reviewers’ mean on those same applications was 3.6, so the like-for-like gap is 0.7.',
                ],
                [
                  'Only staff see this page',
                  'Reviewers do not see it, and it never shows which applications a reviewer scored.',
                ],
              ]}
            />
          </Panel>
          <Panel title="What you can do" className="flex-1">
            <Points
              points={[
                [
                  'Talk it through',
                  'Before the next round, bring the panel together and agree what a 3 looks like. Fairfold never changes anyone’s score.',
                ],
                [
                  'Make the scale clearer',
                  'Disagreement is highest on Value for money. A descriptor for each score in the rubric helps reviewers read it the same way.',
                ],
              ]}
            />
            <Link
              to="/programmes/community-grants/spring-2027/rubric"
              className={buttonClassName('secondary', 'self-start')}
            >
              Review the rubric guidance
            </Link>
          </Panel>
        </div>

        <ChartPanel
          className="lg:col-span-8"
          title="Where reviewers disagree most"
          takeaway={`On ${String(top.share)}% of applications scored by two or more reviewers, their ${top.label} scores were 2 or more points apart, more than for any other criterion.`}
          footnote="Each criterion is scored from 1 to 5, so 2 points apart is, for example, a 2 and a 4."
          summary={`Bars for the five criteria, from most disagreement to least. ${disagreement
            .map((row) => `${row.label}: ${String(row.share)}%`)
            .join('. ')}.`}
          numbers={
            <DataTable
              caption="Disagreement by criterion"
              captionHidden
              columns={disagreementColumns}
              rows={disagreement}
              rowKey={(row) => row.id}
            />
          }
        >
          <HorizontalBars
            series={[{ name: 'Scores 2 or more points apart', fill: 'fill-edge' }]}
            max={30}
            rows={disagreement.map((row, index) => ({
              key: row.id,
              label: (
                <>
                  <span className="font-medium">{row.label}</span>
                  <span className="block text-sm text-muted tabular-nums">
                    {`Weight ${String(weightOf(row))}`}
                  </span>
                </>
              ),
              values: [
                {
                  value: row.share,
                  text: `${String(row.share)}%`,
                  fill: index === 0 ? 'fill-accent' : undefined,
                },
              ],
            }))}
          />
        </ChartPanel>

        <Panel title="Reviews submitted" className="lg:col-span-4 lg:self-start">
          <div className="flex flex-col gap-5">
            {byMean.map((reviewer) => (
              <Meter
                key={reviewer.name}
                label={reviewer.name}
                value={reviewer.submitted}
                max={reviewer.assigned}
                valueText={`${String(reviewer.submitted)} of ${String(reviewer.assigned)}`}
                tone={reviewer.submitted === reviewer.assigned ? 'success' : 'accent'}
              />
            ))}
          </div>
        </Panel>
      </div>
    </InsightFrame>
  );
}
