// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A framework's progress: each indicator's results, targets and baselines
// in range, combined by the indicator's own rule. `sum` adds them and
// `average` takes their mean, to 2 decimal places. `latest` takes the one
// whose period ends last, and of several ending together the one written
// last. A period is in range when it lies wholly within the dates given.

import type {
  FrameworkSummary,
  IndicatorAggregation,
  IndicatorSummary,
  SummaryQuery,
} from '../contracts/index.ts';
import { impactDb, type Args, type FrameworkParams, type ImpactDependencies } from './context.ts';
import { readFrameworkRow, readItems } from './read.ts';

/** One figure of an indicator, with what orders it among the others. */
export interface Figure {
  readonly value: number;
  readonly periodEnd: string;
  readonly writtenAt: Date;
}

/** The figures combined by the rule, or null when there are none. */
export function combine(rule: IndicatorAggregation, figures: readonly Figure[]): number | null {
  if (figures.length === 0) return null;
  // Figures have at most 2 decimal places, so they add up exactly as hundredths.
  const hundredths = figures.reduce((total, { value }) => total + Math.round(value * 100), 0);
  switch (rule) {
    case 'sum':
      return hundredths / 100;
    case 'average':
      return Math.round(hundredths / figures.length) / 100;
    case 'latest':
      return figures.reduce((latest, next) =>
        next.periodEnd > latest.periodEnd ||
        (next.periodEnd === latest.periodEnd && next.writtenAt >= latest.writtenAt)
          ? next
          : latest,
      ).value;
  }
}

export function summaryHandlers(deps: ImpactDependencies) {
  async function getFrameworkSummary({
    tx,
    input,
  }: Args<FrameworkParams & { query: SummaryQuery }>): Promise<FrameworkSummary> {
    const db = impactDb(tx);
    const { frameworkId } = input.params;
    const { programmeId, from, to } = input.query;
    const framework = await readFrameworkRow(tx, frameworkId);
    if (framework === undefined) throw deps.notFound();

    let results = db
      .selectFrom('impact.result')
      .select((eb) => [
        'indicator_id',
        'value',
        eb.cast<string>('period_end', 'text').as('period_end'),
        'updated_at',
      ])
      .where('framework_id', '=', frameworkId);
    let targets = db
      .selectFrom('impact.target')
      .select((eb) => [
        'indicator_id',
        'target',
        'baseline',
        eb.cast<string>('period_end', 'text').as('period_end'),
        'updated_at',
      ])
      .where('framework_id', '=', frameworkId);
    if (programmeId !== undefined) {
      results = results.where('programme_id', '=', programmeId);
      targets = targets.where('programme_id', '=', programmeId);
    }
    if (from !== undefined) {
      results = results.where('period_start', '>=', from);
      targets = targets.where('period_start', '>=', from);
    }
    if (to !== undefined) {
      results = results.where('period_end', '<=', to);
      targets = targets.where('period_end', '<=', to);
    }

    const byIndicator = <T extends { indicator_id: string }>(rows: readonly T[]) =>
      Map.groupBy(rows, (row) => row.indicator_id);
    const resultRows = byIndicator(await results.execute());
    const targetRows = byIndicator(await targets.execute());
    const { indicators } = await readItems(tx, frameworkId);

    return {
      frameworkId,
      version: framework.version,
      indicators: Object.entries(indicators).map(([indicatorId, indicator]): IndicatorSummary => {
        const reported = resultRows.get(indicatorId) ?? [];
        const set = targetRows.get(indicatorId) ?? [];
        const figures = (
          rows: readonly { period_end: string; updated_at: Date }[],
          value: (index: number) => string | null,
        ) =>
          rows.flatMap((row, index) => {
            const text = value(index);
            return text === null
              ? []
              : [{ value: Number(text), periodEnd: row.period_end, writtenAt: row.updated_at }];
          });
        return {
          indicatorId,
          value: combine(
            indicator.aggregation,
            figures(reported, (index) => reported[index]?.value ?? null),
          ),
          resultCount: reported.length,
          latestPeriodEnd: reported.reduce<string | null>(
            (latest, { period_end: end }) => (latest === null || end > latest ? end : latest),
            null,
          ),
          target: combine(
            indicator.aggregation,
            figures(set, (index) => set[index]?.target ?? null),
          ),
          baseline: combine(
            indicator.aggregation,
            figures(set, (index) => set[index]?.baseline ?? null),
          ),
        };
      }),
    };
  }

  return { getFrameworkSummary };
}
