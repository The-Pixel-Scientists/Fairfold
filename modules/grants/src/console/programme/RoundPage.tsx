// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  DataTable,
  PageHeader,
  SummaryList,
  Tabs,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

import { latePolicies } from '../../contracts/index.ts';
import type { Round, Stage } from '../../contracts/index.ts';
import { ConfigHistory } from './ConfigHistory.tsx';
import { formatLocal } from './format.ts';
import { loadRound, loadRoundHistory } from './loaders.ts';
import { LinkButton, ManagePage, useParam } from './Page.tsx';
import { editRoundPath, PROGRAMMES_PATH, programmePath, rubricPath, stagesPath } from './paths.ts';

function RoundDetails({ round }: { round: Round }) {
  return (
    <div className="max-w-4xl">
      <SummaryList
        items={[
          { term: 'Opens', value: formatLocal(round.opensAt) },
          { term: 'Closes', value: formatLocal(round.closesAt) },
          { term: 'Time zone', value: round.timeZone },
          { term: 'Budget', value: formatMoney(round.budget) },
          { term: 'Smallest award', value: formatMoney(round.awardMinimum) },
          { term: 'Largest award', value: formatMoney(round.awardMaximum) },
          {
            term: 'Late applications',
            value: (
              <span className="flex flex-col">
                {latePolicies[round.latePolicy].label}
                <span className="text-sm text-muted">{latePolicies[round.latePolicy].hint}</span>
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

/** A tab's opening lines: what it shows, and the way to change it. */
function TabIntro({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
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

const totalWeight = (stage: Stage) => stage.criteria.reduce((sum, { weight }) => sum + weight, 0);

function stageColumns(roundId: string): readonly Column<Stage>[] {
  return [
    {
      key: 'stage',
      header: 'Stage',
      rowHeader: true,
      cell: (stage) => `${String(stage.position)}. ${stage.name}`,
    },
    {
      key: 'rubric',
      header: 'Rubric',
      cell: (stage) =>
        stage.criteria.length === 0 ? (
          <span className="text-muted">No rubric</span>
        ) : (
          `${String(stage.criteria.length)} ${stage.criteria.length === 1 ? 'criterion' : 'criteria'}, total weight ${String(totalWeight(stage))}`
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'end',
      cell: (stage) => (
        <LinkButton to={rubricPath(roundId, stage.id)}>
          {stage.criteria.length === 0 ? 'Add rubric' : 'Edit rubric'}
          <span className="sr-only"> for {stage.name}</span>
        </LinkButton>
      ),
    },
  ];
}

function StagesTab({ roundId, stages }: { roundId: string; stages: readonly Stage[] }) {
  return (
    <div className="flex flex-col gap-4">
      <TabIntro
        title="Stages and rubrics"
        action={<LinkButton to={stagesPath(roundId)}>Edit stages</LinkButton>}
      >
        Every application moves through these stages in order. A person moves it on; nothing is
        decided automatically. A stage with a rubric is a stage where reviewers score.
      </TabIntro>
      <DataTable
        caption="Stages in this round"
        captionHidden
        columns={stageColumns(roundId)}
        rows={stages}
        rowKey={(stage) => stage.id}
      />
    </div>
  );
}

function namesOf(stages: readonly Stage[]): ReadonlyMap<string, string> {
  return new Map(
    stages.flatMap((stage) => [
      [stage.id, stage.name] as const,
      ...stage.criteria.map((criterion) => [criterion.id, criterion.label] as const),
    ]),
  );
}

function RoundOverview({ roundId }: { roundId: string }) {
  const { state, retry } = useLoad(loadRound, roundId);
  const loaded = state.status === 'ready' ? state.value : null;

  return (
    <>
      <PageHeader
        breadcrumbs={
          loaded
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                { label: loaded.programme.title, to: programmePath(loaded.programme.id) },
                { label: loaded.round.title },
              ]
            : undefined
        }
        title={loaded?.round.title ?? 'Round'}
        description={
          loaded &&
          `Applications open on ${formatLocal(loaded.round.opensAt)} and close on ${formatLocal(loaded.round.closesAt)} (${loaded.round.timeZone}).`
        }
        actions={<LinkButton to={editRoundPath(roundId)}>Edit round</LinkButton>}
      />
      <WhenLoaded state={state} label="Loading the round" retry={retry}>
        {({ round, stages }) => (
          <Tabs
            label="Round sections"
            tabs={[
              { id: 'details', label: 'Details', content: <RoundDetails round={round} /> },
              {
                id: 'stages',
                label: 'Stages and rubrics',
                content: <StagesTab roundId={roundId} stages={stages} />,
              },
              {
                id: 'history',
                label: 'History',
                content: (
                  <div className="max-w-2xl">
                    <ConfigHistory
                      load={loadRoundHistory}
                      id={roundId}
                      names={namesOf(stages)}
                      timeZone={round.timeZone}
                    />
                  </div>
                ),
              },
            ]}
          />
        )}
      </WhenLoaded>
    </>
  );
}

/** One round: its dates, budget and awards, its stages and rubrics, and who changed them and when. */
export default function RoundPage() {
  return (
    <ManagePage title="Round">
      <RoundOverview roundId={useParam('roundId')} />
    </ManagePage>
  );
}
