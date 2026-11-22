// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  DataTable,
  NotFoundPage,
  Notice,
  PageHeader,
  Panel,
  SummaryList,
  Tag,
  WhenLoaded,
  useCan,
  useLoad,
  useSession,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import type { Match, MatchDecision } from '../contracts/index.ts';
import { DecisionDialog } from './DecisionDialog.tsx';
import { Gate, useParam } from './Gate.tsx';
import { loadMatch } from './loaders.ts';
import { ASSURE_PATH } from './paths.ts';
import {
  entryKindWords,
  formatDay,
  formatMoment,
  listOf,
  nameSourceWords,
  outcomeWords,
  percent,
  reasonWords,
  statusLabel,
} from './words.ts';

const ADVISORY =
  'This is a possible match found by comparing names. It is advisory. Nothing has been blocked or rejected. You decide whether it is a real match.';

function Comparison({ match }: { match: Match }) {
  const { entry } = match;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Screened name">
        <SummaryList
          items={[
            { term: 'Name', value: match.screenedName },
            { term: 'Name from', value: nameSourceWords[match.nameSource] },
          ]}
        />
      </Panel>
      <Panel title="Listed entry">
        <SummaryList
          items={[
            { term: 'Name', value: entry.name },
            { term: 'Listed as', value: entryKindWords[match.entryKind] },
            { term: 'Designation', value: entry.designationId },
            { term: 'Regime', value: entry.regime },
            {
              term: 'Designated on',
              value: entry.designatedOn === null ? 'Not given' : formatDay(entry.designatedOn),
            },
            { term: 'Dates of birth', value: listOf(entry.datesOfBirth.map(formatDay)) },
            { term: 'Nationalities', value: listOf(entry.nationalities) },
            { term: 'Country', value: entry.country ?? 'Not given' },
          ]}
        />
      </Panel>
    </div>
  );
}

function History({ decisions }: { decisions: readonly MatchDecision[] }) {
  const { state } = useSession();
  const me = state.status === 'ready' ? state.session.activeMembership?.id : undefined;
  const columns: readonly Column<MatchDecision>[] = [
    { key: 'when', header: 'Decided', rowHeader: true, cell: (row) => formatMoment(row.decidedAt) },
    { key: 'outcome', header: 'Decision', cell: (row) => outcomeWords[row.outcome] },
    { key: 'reason', header: 'Reason', cell: (row) => reasonWords[row.reason] },
    {
      key: 'by',
      header: 'Decided by',
      cell: (row) => (row.decidedBy === me ? 'You' : 'Another member'),
    },
  ];
  return (
    <Panel title="Decisions">
      <DataTable
        caption="Decisions on this match"
        captionHidden
        columns={columns}
        rows={[...decisions].reverse()}
        rowKey={(row) => row.id}
        empty={<p className="text-muted">No one has decided this match yet.</p>}
      />
    </Panel>
  );
}

function Loaded({ match }: { match: Match }) {
  const canDecide = useCan('assure.screening.decide');
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<MatchDecision | null>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const decisions = added === null ? match.decisions : [...match.decisions, added];
  const status = decisions.at(-1)?.outcome ?? 'open';

  useEffect(() => {
    if (added !== null) confirmation.current?.focus();
  }, [added]);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Possible matches', to: ASSURE_PATH }, { label: 'Match' }]}
        title="Possible match"
        eyebrow={<Tag tone={status === 'open' ? 'info' : 'neutral'}>{statusLabel(status)}</Tag>}
        description={`Raised ${formatMoment(match.raisedAt)}. Name similarity ${percent(match.similarity)}.`}
        actions={
          canDecide && (
            <Button
              variant="primary"
              onClick={() => {
                setOpen(true);
              }}
            >
              Record decision
            </Button>
          )
        }
      />
      <Notice tone="info" title="This match is advisory">
        {ADVISORY}
      </Notice>
      {added !== null && (
        <Notice tone="success" title="Decision recorded">
          <h2 ref={confirmation} tabIndex={-1} className="font-semibold outline-offset-4">
            {`Decision recorded: ${outcomeWords[added.outcome]}`}
          </h2>
          <p>Nothing has been rejected, blocked or paid. The applicant has not been told.</p>
        </Notice>
      )}
      <Comparison match={match} />
      <p className="text-muted">
        {`Sanctions list published ${formatDay(match.list.publishedOn)}, downloaded ${formatMoment(match.list.downloadedAt)}.`}
      </p>
      <History decisions={decisions} />
      <DecisionDialog matchId={match.id} open={open} onOpenChange={setOpen} onDecided={setAdded} />
    </>
  );
}

function Screen() {
  const matchId = useParam('matchId');
  const { state, retry } = useLoad(loadMatch, matchId);
  return (
    <WhenLoaded state={state} label="Loading the match" retry={retry}>
      {(match) => ('state' in match ? <NotFoundPage /> : <Loaded match={match} />)}
    </WhenLoaded>
  );
}

/** The read starts inside the gate, so with assure off nothing is asked of the server. */
export default function MatchPage() {
  return (
    <Gate permission="assure.screening.read">
      <Screen />
    </Gate>
  );
}
