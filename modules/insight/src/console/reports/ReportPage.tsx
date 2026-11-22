// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  asProblem,
  Button,
  Dialog,
  ErrorSummary,
  LoadingState,
  Notice,
  PageHeader,
  SummaryList,
  Tag,
  useCan,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useRef, useState } from 'react';

import type { MonitoringReport, ReportDefinition, ReportResult } from '../../contracts/index.ts';
import { archiveReport, loadReport, runEqualityReport, runWarehouseReport } from '../api.ts';
import { formatDate, plainName, reportKindLabels } from '../format.ts';
import { MonitoringTable } from '../monitoring/MonitoringTable.tsx';
import { insightPath } from '../paths.ts';
import { LinkButton, Section } from '../parts.tsx';
import { WarehouseResult } from './ReportResult.tsx';

const UNEXPECTED = 'Something went wrong. Try again.';
const RUN_BUTTON = 'run-report';

type Outcome =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'failed'; message: string }
  | { status: 'warehouse'; result: ReportResult }
  | { status: 'monitoring'; report: MonitoringReport };

function Details({ report }: { report: ReportDefinition }) {
  return (
    <SummaryList
      items={[
        { term: 'Kind', value: reportKindLabels[report.kind] },
        { term: 'Version', value: report.version },
        { term: 'Last changed', value: formatDate(report.updatedAt) },
        {
          term: report.kind === 'warehouse' ? 'Reads' : 'Question',
          value: plainName(report.source),
        },
        ...(report.description === null
          ? []
          : [{ term: 'Description', value: report.description }]),
      ]}
    />
  );
}

function done(outcome: Outcome): string {
  if (outcome.status === 'warehouse') {
    const rows = outcome.result.rows.length;
    return `Report run. ${String(rows)} ${rows === 1 ? 'row' : 'rows'} shown.`;
  }
  if (outcome.status === 'monitoring') {
    return outcome.report.result.status === 'withheld'
      ? 'Report run. The figures are not shown.'
      : 'Report run. The figures are shown.';
  }
  return '';
}

function Content({ initial }: { initial: ReportDefinition }) {
  const [report, setReport] = useState(initial);
  const [outcome, setOutcome] = useState<Outcome>({ status: 'idle' });
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const running = useRef(false);
  const canManage = useCan('insight.reports.manage');
  const canRunMonitoring = useCan('insight.monitoring.report');
  const archived = report.archivedAt !== null;
  const canRun = !archived && (report.kind === 'warehouse' || canRunMonitoring);

  async function run() {
    if (running.current) return;
    running.current = true;
    setOutcome({ status: 'running' });
    try {
      setOutcome(
        report.kind === 'warehouse'
          ? { status: 'warehouse', result: await runWarehouseReport(report.id) }
          : { status: 'monitoring', report: await runEqualityReport(report.id) },
      );
    } catch (error) {
      setOutcome({ status: 'failed', message: asProblem(error)?.detail ?? UNEXPECTED });
    } finally {
      running.current = false;
    }
  }

  async function archive() {
    try {
      setReport(await archiveReport(report.id));
      setArchiving(false);
      setOutcome({ status: 'idle' });
    } catch (error) {
      setArchiveError(asProblem(error)?.detail ?? UNEXPECTED);
    }
  }

  return (
    <div className="flex flex-col gap-stack">
      <PageHeader
        title={report.name}
        breadcrumbs={[{ label: 'Reports', to: insightPath('reports') }, { label: report.name }]}
        eyebrow={archived ? <Tag>Archived</Tag> : undefined}
        actions={
          <>
            {canRun && (
              <Button
                id={RUN_BUTTON}
                variant="primary"
                aria-disabled={outcome.status === 'running' || undefined}
                onClick={() => {
                  void run();
                }}
              >
                Run report
              </Button>
            )}
            {canManage && !archived && (
              <>
                <LinkButton to={insightPath('report-edit', { id: report.id })}>
                  Edit report
                </LinkButton>
                <Button
                  variant="danger"
                  onClick={() => {
                    setArchiveError(null);
                    setArchiving(true);
                  }}
                >
                  Archive report
                </Button>
              </>
            )}
          </>
        }
      />
      <Details report={report} />
      {archived && (
        <Notice tone="neutral" title="This report is archived">
          Make a new report to change or run it.
        </Notice>
      )}
      <div role="status">
        {outcome.status === 'running' && <LoadingState label="Running the report" />}
        {done(outcome) !== '' && <p className="sr-only">{done(outcome)}</p>}
      </div>
      {outcome.status === 'failed' && (
        <ErrorSummary errors={[{ fieldId: RUN_BUTTON, message: outcome.message }]} />
      )}
      {outcome.status === 'warehouse' && (
        <Section title="Figures">
          <WarehouseResult report={report} result={outcome.result} />
        </Section>
      )}
      {outcome.status === 'monitoring' && (
        <Section title="Figures">
          <MonitoringTable report={outcome.report} title={report.name} />
        </Section>
      )}
      <Dialog
        open={archiving}
        onOpenChange={setArchiving}
        title="Archive this report?"
        description="An archived report can no longer be changed or run. Its history stays."
        actions={
          <>
            <Button
              data-autofocus
              onClick={() => {
                setArchiving(false);
              }}
            >
              Keep report
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void archive();
              }}
            >
              Archive report
            </Button>
          </>
        }
      >
        {archiveError !== null && (
          <p role="alert" className="text-body font-medium text-danger">
            {archiveError}
          </p>
        )}
      </Dialog>
    </div>
  );
}

export default function ReportPage({ reportId }: { reportId: string }) {
  const { state, retry } = useLoad(loadReport, reportId);
  return (
    <WhenLoaded state={state} label="Loading the report" retry={retry}>
      {(report) => <Content key={report.id} initial={report} />}
    </WhenLoaded>
  );
}
