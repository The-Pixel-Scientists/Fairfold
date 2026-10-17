// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  DataTable,
  EmptyState,
  Link,
  PageHeader,
  SummaryList,
  useLoad,
  useSort,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';

import { outcomeIds, outcomes } from '../../contracts/index.ts';
import type { EmailTemplates, Outcome, Round } from '../../contracts/index.ts';
import { ConfigHistory } from './ConfigHistory.tsx';
import { formatAwards, formatLocalDay } from './format.ts';
import { loadEmails, loadProgramme, loadProgrammeHistory, loadRounds } from './loaders.ts';
import { LinkButton, ManagePage, Section, StatusTag, useParam } from './Page.tsx';
import {
  editProgrammePath,
  emailsPath,
  newRoundPath,
  PROGRAMMES_PATH,
  roundPath,
} from './paths.ts';

const roundColumns: readonly Column<Round>[] = [
  {
    key: 'round',
    header: 'Round',
    sortable: true,
    rowHeader: true,
    cell: (round) => <Link to={roundPath(round.id)}>{round.title}</Link>,
  },
  { key: 'opens', header: 'Opens', sortable: true, cell: (round) => formatLocalDay(round.opensAt) },
  {
    key: 'closes',
    header: 'Closes',
    sortable: true,
    cell: (round) => formatLocalDay(round.closesAt),
  },
  {
    key: 'budget',
    header: 'Budget',
    align: 'end',
    sortable: true,
    cell: (round) => formatMoney(round.budget),
  },
  {
    key: 'awards',
    header: 'Awards',
    cell: (round) => formatAwards(round.awardMinimum, round.awardMaximum),
  },
];

const sortKeys = {
  round: (round: Round) => round.title,
  opens: (round: Round) => round.opensAt,
  closes: (round: Round) => round.closesAt,
  budget: (round: Round) => round.budget.amountMinor,
};

function RoundTable({ rounds, programmeId }: { rounds: readonly Round[]; programmeId: string }) {
  const { sort, setSort, sorted } = useSort(rounds, sortKeys, {
    key: 'opens',
    direction: 'descending',
  });
  return (
    <DataTable
      caption="Rounds"
      captionHidden
      columns={roundColumns}
      rows={sorted}
      rowKey={(round) => round.id}
      {...(sort && { sort })}
      onSortChange={setSort}
      empty={
        <EmptyState
          title="No rounds yet"
          headingLevel="h3"
          action={
            <LinkButton to={newRoundPath(programmeId)} variant="primary">
              Add a round
            </LinkButton>
          }
        >
          <p>
            A round has opening and closing dates, a budget and an award range, and starts with the
            stages Intake, Review and Decision.
          </p>
        </EmptyState>
      }
    />
  );
}

function Rounds({ programmeId }: { programmeId: string }) {
  const { state, retry } = useLoad(loadRounds, programmeId);
  return (
    <Section title="Rounds">
      <WhenLoaded state={state} label="Loading rounds" retry={retry}>
        {({ rounds }) => <RoundTable rounds={rounds} programmeId={programmeId} />}
      </WhenLoaded>
    </Section>
  );
}

interface EmailRow {
  outcome: Outcome;
  subject: string;
  version: number;
}

const emailColumns: readonly Column<EmailRow>[] = [
  { key: 'email', header: 'Email', rowHeader: true, cell: (row) => outcomes[row.outcome] },
  { key: 'subject', header: 'Subject', cell: (row) => row.subject },
  { key: 'version', header: 'Version', align: 'end', cell: (row) => row.version },
];

const emailRows = (templates: EmailTemplates): EmailRow[] =>
  outcomeIds.map((outcome) => ({ outcome, ...templates[outcome] }));

/** The three outcome emails as they stand, with the way to change them. */
function OutcomeEmails({ programmeId }: { programmeId: string }) {
  const { state, retry } = useLoad(loadEmails, programmeId);
  return (
    <Section
      title="Outcome emails"
      action={<LinkButton to={emailsPath(programmeId)}>Edit emails</LinkButton>}
    >
      <WhenLoaded state={state} label="Loading emails" retry={retry}>
        {(templates) => (
          <DataTable
            caption="Outcome emails"
            captionHidden
            columns={emailColumns}
            rows={emailRows(templates)}
            rowKey={(row) => row.outcome}
          />
        )}
      </WhenLoaded>
    </Section>
  );
}

function Programme({ programmeId }: { programmeId: string }) {
  const { state, retry } = useLoad(loadProgramme, programmeId);
  const programme = state.status === 'ready' ? state.value : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Programmes', to: PROGRAMMES_PATH },
          { label: programme?.title ?? 'Programme' },
        ]}
        eyebrow={programme && <StatusTag status={programme.status} />}
        title={programme?.title ?? 'Programme'}
        description={programme?.summary}
        actions={
          <>
            <LinkButton to={editProgrammePath(programmeId)}>Edit programme</LinkButton>
            <LinkButton to={newRoundPath(programmeId)} variant="primary">
              New round
            </LinkButton>
          </>
        }
      />
      <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <WhenLoaded state={state} label="Loading the programme" retry={retry}>
            {({ description }) => (
              <Section title="About this programme">
                <SummaryList
                  items={[
                    {
                      term: 'Description',
                      value:
                        description === '' ? (
                          <span className="text-muted">No description yet.</span>
                        ) : (
                          <span className="whitespace-pre-line">{description}</span>
                        ),
                    },
                  ]}
                />
              </Section>
            )}
          </WhenLoaded>
          <Rounds programmeId={programmeId} />
          <OutcomeEmails programmeId={programmeId} />
        </div>
        <ConfigHistory load={loadProgrammeHistory} id={programmeId} />
      </div>
    </>
  );
}

/** One programme: what it is for, its rounds and emails, and who changed its set-up and when. */
export default function ProgrammePage() {
  return (
    <ManagePage title="Programme">
      <Programme programmeId={useParam('programmeId')} />
    </ManagePage>
  );
}
