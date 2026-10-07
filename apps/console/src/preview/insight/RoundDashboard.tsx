// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, DataTable, EmptyState, Stats } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useState } from 'react';

import { pounds, programmes } from '../story.ts';
import { ChartPanel } from './ChartPanel.tsx';
import { DailyColumns } from './charts/DailyColumns.tsx';
import { Funnel, kept } from './charts/Funnel.tsx';
import type { FunnelStep } from './charts/Funnel.tsx';
import { HorizontalBars } from './charts/HorizontalBars.tsx';
import { FilterChip } from './FilterChip.tsx';
import { percent } from './format.ts';
import { InsightFrame } from './InsightFrame.tsx';
import {
  budget,
  dayLabel,
  figuresFor,
  daysToDecision,
  roundDays,
  submitted,
  themes,
} from './roundData.ts';

const ALL = 'all';
const SHOWN_ROUND = 'spring-2027';
const LAST_DAYS = 3;

const themeOptions = [
  { value: ALL, label: 'All themes' },
  ...themes.map((theme) => ({ value: theme.id, label: theme.label })),
];

const programmeOptions = programmes.map((programme) => ({
  value: programme.id,
  label: programme.name,
}));

/** The step that keeps the smallest share of the one before it, after submission. */
function narrowestStep(steps: readonly FunnelStep[]): string {
  let narrowest = 2;
  for (let index = 3; index < steps.length; index += 1) {
    if ((kept(steps, index) ?? 1) < (kept(steps, narrowest) ?? 1)) narrowest = index;
  }
  const step = steps[narrowest];
  const before = steps[narrowest - 1];
  const share = kept(steps, narrowest);
  if (!step || !before || share === null) return '';
  return `Only ${percent(step.count, before.count)} got from ${before.label.toLowerCase()} to ${step.label.toLowerCase()}, the narrowest step.`;
}

interface StepRow {
  step: FunnelStep;
  kept: number | null;
  fellAway: number;
}

const stepColumns: readonly Column<StepRow>[] = [
  { key: 'step', header: 'Step', rowHeader: true, cell: (row) => row.step.label },
  { key: 'count', header: 'Applications', align: 'end', cell: (row) => row.step.count },
  {
    key: 'kept',
    header: 'Kept from the step before',
    align: 'end',
    cell: (row) => (row.kept === null ? '–' : `${String(Math.round(row.kept * 100))}%`),
  },
  {
    key: 'fell',
    header: 'Fell away',
    align: 'end',
    cell: (row) => (row.kept === null ? '–' : row.fellAway),
  },
];

interface DayRow {
  index: number;
  count: number;
  total: number;
}

const dayColumns: readonly Column<DayRow>[] = [
  { key: 'date', header: 'Date', rowHeader: true, cell: (row) => dayLabel(row.index) },
  { key: 'count', header: 'Submitted', align: 'end', cell: (row) => row.count },
  { key: 'total', header: 'Total so far', align: 'end', cell: (row) => row.total },
];

const themeColumns: readonly Column<(typeof themes)[number]>[] = [
  { key: 'theme', header: 'Theme', rowHeader: true, cell: (row) => row.label },
  { key: 'applications', header: 'Applications', align: 'end', cell: submitted },
  { key: 'requested', header: 'Requested', align: 'end', cell: (row) => pounds(row.requested) },
  { key: 'awarded', header: 'Awarded', align: 'end', cell: (row) => pounds(row.awarded) },
  {
    key: 'share',
    header: 'Share awarded',
    align: 'end',
    cell: (row) => percent(row.awarded, row.requested),
  },
];

const byRequested = [...themes].sort((a, b) => b.requested - a.requested);
const byShare = [...themes].sort((a, b) => b.awarded / b.requested - a.awarded / a.requested);
const [mostFunded, leastFunded] = [byShare[0], byShare[byShare.length - 1]];

export default function RoundDashboard() {
  const [programmeId, setProgrammeId] = useState('community-grants');
  const [roundId, setRoundId] = useState(SHOWN_ROUND);
  const [themeId, setThemeId] = useState(ALL);

  const programme = programmes.find((item) => item.id === programmeId) ?? programmes[0];
  const round = programme?.rounds.find((item) => item.id === roundId) ?? programme?.rounds[0];
  const roundOptions = (programme?.rounds ?? []).map((item) => ({
    value: item.id,
    label: item.name,
  }));
  const showFigures = round?.id === SHOWN_ROUND;
  const filtered = showFigures && themeId !== ALL;

  const chosen = filtered ? themes.filter((theme) => theme.id === themeId) : themes;
  const figures = figuresFor(chosen);
  const everything = figuresFor(themes);

  const steps: readonly FunnelStep[] = [
    { key: 'started', label: 'Started', count: figures.started },
    { key: 'submitted', label: 'Submitted', count: figures.submitted },
    { key: 'eligible', label: 'Eligible', count: figures.eligible },
    { key: 'reviewed', label: 'Reviewed', count: figures.reviewed },
    { key: 'shortlisted', label: 'Shortlisted', count: figures.shortlisted },
    { key: 'awarded', label: 'Awarded', count: figures.grants },
  ];
  const stepRows: readonly StepRow[] = steps.map((step, index) => ({
    step,
    kept: kept(steps, index),
    fellAway: (steps[index - 1]?.count ?? step.count) - step.count,
  }));

  const peak = Math.max(...figures.perDay);
  const top = Math.max(5, Math.ceil(peak / 5) * 5);
  const lastDays = figures.perDay.slice(-LAST_DAYS).reduce((sum, value) => sum + value, 0);
  const dayRows: readonly DayRow[] = figures.perDay.map((count, index) => ({
    index,
    count,
    total: figures.perDay.slice(0, index + 1).reduce((sum, value) => sum + value, 0),
  }));

  const status = !showFigures
    ? ''
    : filtered
      ? `Showing ${chosen[0]?.label ?? ''}: ${String(figures.submitted)} of ${String(everything.submitted)} applications`
      : `Showing all themes: ${String(figures.submitted)} applications`;

  return (
    <InsightFrame
      context={`${programme?.name ?? ''}, ${round?.name ?? ''}`}
      title="Round dashboard"
      description={
        showFigures
          ? 'How the round went, from first starts to awards. Decisions were released on 1 April 2027.'
          : 'Choose a round to see how it went, from first starts to awards.'
      }
      actions={showFigures ? <Button>Export figures as CSV</Button> : undefined}
    >
      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
        <FilterChip
          label="Programme"
          value={programmeId}
          options={programmeOptions}
          onChange={(value) => {
            setProgrammeId(value);
            setRoundId(programmes.find((item) => item.id === value)?.rounds[0]?.id ?? '');
          }}
        />
        <FilterChip label="Round" value={roundId} options={roundOptions} onChange={setRoundId} />
        {showFigures && (
          <FilterChip
            label="Theme"
            value={themeId}
            options={themeOptions}
            onChange={setThemeId}
            active={filtered}
          />
        )}
        {filtered && (
          <Button
            variant="quiet"
            className="min-h-8"
            onClick={() => {
              setThemeId(ALL);
            }}
          >
            Clear theme
          </Button>
        )}
      </div>
      <p role="status" className="sr-only">
        {status}
      </p>

      {!showFigures ? (
        <EmptyState
          title={
            round?.applications === 0
              ? 'No applications yet'
              : 'These figures are not in the preview'
          }
          action={
            <Button
              onClick={() => {
                setProgrammeId('community-grants');
                setRoundId(SHOWN_ROUND);
              }}
            >
              Show Community Grants, Spring 2027
            </Button>
          }
        >
          <p>
            {round?.applications === 0
              ? `Figures appear once ${round.name} opens on ${round.opens}.`
              : 'The preview has figures for one round only.'}
          </p>
        </EmptyState>
      ) : (
        <>
          <Stats
            label="Round summary"
            items={[
              {
                label: 'Received',
                value: figures.submitted,
                detail: `of ${String(figures.started)} started`,
              },
              {
                label: 'Eligible',
                value: figures.eligible,
                detail: `${percent(figures.eligible, figures.submitted)} of those received`,
              },
              {
                label: 'Requested',
                value: pounds(figures.requested),
                detail: filtered
                  ? `${percent(figures.requested, everything.requested)} of all requests`
                  : `${(figures.requested / budget).toFixed(1)} times the ${pounds(budget)} budget`,
              },
              {
                label: 'Awarded',
                value: pounds(figures.awarded),
                detail: filtered
                  ? `${percent(figures.awarded, everything.awarded)} of all awarded`
                  : `${percent(figures.awarded, budget)} of the ${pounds(budget)} budget`,
              },
              {
                label: 'Time to decision',
                value: `${String(daysToDecision)} days`,
                detail: 'From closing on 3 March to release on 1 April',
              },
            ]}
          />

          <div className="grid gap-6 xl:grid-cols-5">
            <ChartPanel
              className="xl:col-span-2"
              title="Where applications go"
              takeaway={narrowestStep(steps)}
              summary={`Funnel from ${String(figures.started)} started to ${String(figures.grants)} awarded. ${steps
                .slice(1)
                .map((step) => `${step.label} ${String(step.count)}`)
                .join(', ')}.`}
              numbers={
                <DataTable
                  caption="Applications at each step"
                  captionHidden
                  columns={stepColumns}
                  rows={stepRows}
                  rowKey={(row) => row.step.key}
                />
              }
            >
              <Funnel steps={steps} />
            </ChartPanel>

            <ChartPanel
              className="xl:col-span-3"
              title="Submissions per day"
              takeaway={`${percent(lastDays, figures.submitted)} arrived in the last three days.`}
              summary={`Columns for each day from ${dayLabel(0)} to ${dayLabel(roundDays - 1)}. ${String(lastDays)} of ${String(figures.submitted)} submissions arrived in the last three days, before the round closed on ${dayLabel(roundDays - 1)} at 5pm.`}
              numbers={
                <DataTable
                  caption="Submissions on each day of the round"
                  captionHidden
                  columns={dayColumns}
                  rows={dayRows}
                  rowKey={(row) => String(row.index)}
                />
              }
            >
              <DailyColumns
                values={figures.perDay}
                max={top}
                unit="submissions a day"
                emphasisFrom={roundDays - LAST_DAYS}
                bracket={`${String(lastDays)} of ${String(figures.submitted)} in the last three days`}
                ticks={[
                  { index: 0, label: dayLabel(0, 'short'), anchor: 'start' },
                  ...[7, 14, 21].map((index) => ({
                    index,
                    label: dayLabel(index, 'short'),
                    optional: true,
                  })),
                  {
                    index: roundDays - 1,
                    label: `Closed ${dayLabel(roundDays - 1, 'short')}, 5pm`,
                    anchor: 'end' as const,
                    strong: true,
                  },
                ]}
              />
            </ChartPanel>
          </div>

          <ChartPanel
            title="Requested and awarded by theme"
            takeaway={
              mostFunded && leastFunded
                ? `${mostFunded.label} had the most of its requests awarded (${percent(mostFunded.awarded, mostFunded.requested)}) and ${leastFunded.label} the least (${percent(leastFunded.awarded, leastFunded.requested)}).`
                : ''
            }
            summary={`Paired bars for ${String(themes.length)} themes. ${byRequested
              .map(
                (theme) =>
                  `${theme.label}: ${pounds(theme.requested)} requested, ${pounds(theme.awarded)} awarded`,
              )
              .join('. ')}.`}
            numbers={
              <DataTable
                caption="Requested and awarded for each theme"
                captionHidden
                columns={themeColumns}
                rows={byRequested}
                rowKey={(row) => row.id}
              />
            }
          >
            <HorizontalBars
              series={[
                { name: 'Requested', fill: 'fill-edge' },
                { name: 'Awarded', fill: 'fill-accent' },
              ]}
              max={byRequested[0]?.requested ?? 1}
              rows={byRequested.map((theme) => ({
                key: theme.id,
                faded: filtered && theme.id !== themeId,
                label: (
                  <>
                    <span className="font-medium">{theme.label}</span>
                    <span className="block text-sm text-muted tabular-nums">
                      {`${String(submitted(theme))} applications`}
                    </span>
                  </>
                ),
                note: `${percent(theme.awarded, theme.requested)} awarded`,
                values: [
                  { value: theme.requested, text: pounds(theme.requested) },
                  { value: theme.awarded, text: pounds(theme.awarded) },
                ],
              }))}
            />
          </ChartPanel>
        </>
      )}
    </InsightFrame>
  );
}
