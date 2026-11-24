// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Running an equality monitoring report (ADR 0032). The platform has already
// checked the session, the permission and that insight is on. Grants' server
// counts the answers inside this request's transaction, and the counts go
// straight to the suppression function: they are never returned, logged,
// stored, audited or kept past the request. Only the suppressed table leaves,
// and the run log keeps it (run-log.ts), which may refuse the run. A refusal
// is kept with its audit event and answered after the commit. The run's audit
// event holds the report and the rule's version, never a count.

import {
  insightRefusals,
  type MonitoringReport,
  type MonitoringBreakdown,
} from '../contracts/index.ts';
import type { Args, InsightDependencies, MonitoringCounts, ReportParams } from './context.ts';
import { appliedRule } from './disclosure.ts';
import { inputOf, readDefinitionRow } from './definitions.ts';
import { serverRefusals } from './messages.ts';
import { insertRun, lockQuestion, revealsSmallGroup, type RunTable } from './run-log.ts';
import { disclose, type CountTable } from './suppress.ts';

type Counted = Extract<MonitoringCounts, { status: 'counted' }>;

/** One question's counts over the rounds counted, one row for each option. */
function tableOf(counts: Counted, question: string, breakdown: MonitoringBreakdown | null) {
  const options = new Map<string, number>();
  let respondents = 0;
  for (const round of counts.rounds) {
    respondents += round.responses;
    const asked = round.questions.find(({ fieldId }) => fieldId === question);
    for (const { value, count } of asked?.options ?? []) {
      options.set(value, (options.get(value) ?? 0) + count);
    }
  }
  const table: CountTable = {
    breakdown,
    columns: [],
    rows: [...options].map(([option, count]) => ({ option, cells: [count] })),
    respondents,
  };
  return table;
}

export function monitoringHandlers(deps: InsightDependencies) {
  async function runMonitoringReport({
    tx,
    context,
    input,
  }: Args<ReportParams>): Promise<MonitoringReport> {
    const { reportId } = input.params;
    const row = await readDefinitionRow(tx, reportId);
    if (row === undefined) throw deps.notFound();
    const definition = inputOf(row);
    if (definition.kind !== 'monitoring') throw deps.refuse(409, insightRefusals.notMonitoring);
    if (row.archived_at !== null) throw deps.refuse(409, insightRefusals.archived);

    const breakdown = Object.values(definition.groupBy)[0] ?? null;
    const filter = Object.values(definition.filters)[0] ?? null;
    // Grants counts by round alone for now, and has no breakdown by outcome or stage.
    if (breakdown !== null || filter?.field !== 'round') {
      throw deps.refuse(409, serverRefusals.oneRound);
    }

    const rule = await appliedRule(tx);
    const counts = await deps.monitoringCounts(tx, [filter.value]);
    if (counts.status === 'grants_off') throw deps.refuse(409, serverRefusals.needsGrants);
    const counted = tableOf(counts, definition.source, breakdown);
    const result = disclose(counted, rule);

    const table: RunTable = { question: definition.source, breakdown, roundId: filter.value };
    const run = {
      reportId,
      reportVersion: row.version,
      kind: 'monitoring',
      ruleVersion: rule.version,
    } as const;
    const by = context.membership.id;
    const changes = {
      'insight.report_definition.version': { after: row.version },
      'insight.disclosure_rule.version': { after: rule.version },
    };

    let outcome: 'shown' | 'withheld' | 'refused' = result.status;
    const now = result.status === 'shown' && {
      responses: counted.respondents,
      table: result.table,
    };
    if (now) {
      await lockQuestion(tx, definition.source);
      if (await revealsSmallGroup(tx, table, now, rule)) outcome = 'refused';
    }
    const runId = await insertRun(tx, {
      ...run,
      outcome,
      by,
      table,
      ...(now && outcome === 'shown'
        ? { shown: { ...now, roundIds: counts.rounds.map(({ roundId }) => roundId) } }
        : {}),
    });

    await context.audit.record({
      action:
        outcome === 'refused'
          ? 'insight.monitoring_report.refused'
          : 'insight.monitoring_report.run',
      entityId: reportId,
      changes,
    });
    // The refusal is answered once the run and its event are kept, and shows nothing of the table.
    if (outcome === 'refused') {
      context.afterCommit(() =>
        Promise.reject(deps.refuse(409, insightRefusals.monitoringRefused)),
      );
    }
    return {
      runId,
      reportId,
      reportVersion: row.version,
      question: definition.source,
      breakdown,
      filter,
      disclosureRule: rule,
      result: outcome === 'shown' ? result : { status: 'withheld' },
    };
  }

  return { runMonitoringReport };
}
