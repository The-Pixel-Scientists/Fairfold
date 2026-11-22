// SPDX-License-Identifier: AGPL-3.0-or-later

import { DataTable, EmptyState } from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import type { Framework, FrameworkSummary } from '../contracts/index.ts';
import { None, Section } from './Page.tsx';
import { formatDay, formatFigure, progressPercent } from './words.ts';

type Indicator = Framework['indicators'][string];

interface Row {
  id: string;
  indicator: Indicator;
  outcome: string;
  summary: FrameworkSummary['indicators'][number];
}

/** One row for each indicator the summary lists, in its order, with the outcome it measures. */
export function progressRows(framework: Framework, summary: FrameworkSummary): Row[] {
  return summary.indicators.flatMap((entry) => {
    const indicator = framework.indicators[entry.indicatorId];
    return indicator === undefined
      ? []
      : [
          {
            id: entry.indicatorId,
            indicator,
            outcome: framework.outcomes[indicator.outcomeId]?.name ?? '',
            summary: entry,
          },
        ];
  });
}

const columns: readonly Column<Row>[] = [
  {
    key: 'indicator',
    header: 'Indicator',
    rowHeader: true,
    cell: (row) => (
      <span className="flex min-w-48 max-w-96 flex-col whitespace-normal">
        {row.indicator.name}
        <span className="text-sm font-normal text-muted">{row.outcome}</span>
      </span>
    ),
  },
  {
    key: 'value',
    header: 'Result so far',
    align: 'end',
    cell: ({ indicator, summary }) =>
      summary.value === null ? <None /> : formatFigure(indicator.unit, summary.value),
  },
  {
    key: 'target',
    header: 'Target',
    align: 'end',
    cell: ({ indicator, summary }) =>
      summary.target === null ? 'No target set' : formatFigure(indicator.unit, summary.target),
  },
  {
    key: 'progress',
    header: 'Progress',
    align: 'end',
    cell: ({ indicator, summary }) => {
      const percent = progressPercent(summary, indicator.direction);
      return percent === null ? <None /> : `${String(percent)}% of the way`;
    },
  },
  {
    key: 'latest',
    header: 'Latest result to',
    cell: ({ summary }) =>
      summary.latestPeriodEnd === null ? <None /> : formatDay(summary.latestPeriodEnd),
  },
];

/** Each indicator's combined results beside its target. */
export function ProgressSection({
  framework,
  summary,
}: {
  framework: Framework;
  summary: FrameworkSummary;
}) {
  const rows = progressRows(framework, summary);
  return (
    <Section title="Progress">
      {rows.length === 0 ? (
        <EmptyState title="No indicators yet">
          <p>Add an indicator to an outcome by editing the framework. Progress shows here.</p>
        </EmptyState>
      ) : (
        <DataTable
          caption="Progress by indicator"
          captionHidden
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
        />
      )}
    </Section>
  );
}
