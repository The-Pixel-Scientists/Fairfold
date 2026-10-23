// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatMoney } from '@pixel-scientists/domain/platform';
import {
  BulkActionBar,
  Button,
  buttonClassName,
  EmptyState,
  Link,
  Meter,
  Notice,
  PageHeader,
  ShortcutsDialog,
  Stats,
  useCan,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import type { ShortcutGroup } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import type { DecisionList, DecisionRow } from '../../contracts/index.ts';
import { FilterTabs } from '../assessment/FilterTabs.tsx';
import { useParam } from '../assessment/Page.tsx';
import { problemLines } from '../assessment/problems.ts';
import { PROGRAMMES_PATH, programmePath, roundPath } from '../programme/paths.ts';
import { SUBMISSIONS_PATH } from '../submissions/paths.ts';
import { BulkDecisionDialog } from './BulkDecisionDialog.tsx';
import { DecisionDialog } from './DecisionDialog.tsx';
import { DecisionsTable } from './DecisionsTable.tsx';
import { EmailDialog } from './EmailDialog.tsx';
import { loadDecisionPage, loadDecisions } from './loaders.ts';
import { Gate } from './Page.tsx';
import { releasePath } from './paths.ts';
import { budgetWords, countOf, deliveryWords, overBudget, tally } from './totals.ts';
import { UnsentEmails } from './UnsentEmails.tsx';

type Filter = 'all' | 'undecided' | 'accepted' | 'waitlisted' | 'declined';

const shortcuts: readonly ShortcutGroup[] = [
  {
    title: 'In the table',
    shortcuts: [
      { keys: ['Arrow up', 'Arrow down'], does: 'Move to the row above or below' },
      { keys: ['Home', 'End'], does: 'Move to the first or last row' },
      { keys: ['Enter'], does: 'Record or change the decision' },
      { keys: ['Space'], does: 'Select or deselect the submission' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
];

const noun = { one: 'submission', other: 'submissions' };

const matches = (row: DecisionRow, filter: Filter): boolean =>
  filter === 'all' || (row.decision?.outcome ?? 'undecided') === filter;

const isReleased = (row: DecisionRow) => (row.decision?.releasedAt ?? null) !== null;

type Open = { kind: 'one' | 'email'; submissionId: string } | { kind: 'many' } | null;

function Decisions({
  roundId,
  initial,
  onHelp,
}: {
  roundId: string;
  initial: DecisionList;
  onHelp: () => void;
}) {
  const [list, setList] = useState(initial);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState('');
  const [announced, setAnnounced] = useState(0);
  const status = useRef<HTMLDivElement>(null);
  const counts = tally(list.submissions);
  const over = overBudget(list);
  const total = list.submissions.length;
  const chosen = list.submissions.filter((row) => selected.has(row.submissionId));
  const current =
    open && open.kind !== 'many'
      ? (list.submissions.find((row) => row.submissionId === open.submissionId) ?? null)
      : null;

  useEffect(() => {
    if (announced > 0) status.current?.focus();
  }, [announced]);

  /**
   * Says what happened, then reads the list again; a failed read says so after
   * what was done. Focus moves to the message when the button that was used has gone.
   */
  async function refreshed(message: string, moveFocus: boolean) {
    try {
      setList(await loadDecisions(roundId));
      setNotice(message);
    } catch (error) {
      setNotice(`${message} The list could not be refreshed: ${problemLines(error).join(' ')}`);
    }
    if (moveFocus) setAnnounced((count) => count + 1);
  }

  const close = (next: boolean) => {
    if (!next) setOpen(null);
  };

  if (total === 0) {
    return (
      <EmptyState
        title="No submissions to decide yet"
        action={
          <Link to={`${SUBMISSIONS_PATH}?roundId=${roundId}`} className={buttonClassName()}>
            Go to submissions
          </Link>
        }
      >
        <p>
          Decisions are recorded for submitted applications. They appear here once applicants send
          them in.
        </p>
      </EmptyState>
    );
  }

  return (
    <>
      <Notice icon="lock" tone="info" title="Applicants see nothing until you release decisions">
        Recording a decision keeps it private to staff. Releasing tells every applicant their
        outcome by email, after you confirm it is you.
      </Notice>
      <div ref={status} role="status" tabIndex={-1} className="empty:hidden">
        {notice !== '' && <Notice tone="success" title={notice} />}
      </div>
      <UnsentEmails
        roundId={roundId}
        count={list.unsentEmails}
        onSent={(delivery) => {
          void refreshed(deliveryWords(delivery), true);
        }}
      />
      <div className="flex flex-col gap-4">
        <Stats
          label="Decision summary"
          items={[
            {
              label: 'Awarded',
              value: formatMoney(list.awarded),
              detail: `to ${countOf(counts.accepted, 'submission')}`,
            },
            { label: 'Waitlisted', value: counts.waitlisted },
            { label: 'Declined', value: counts.declined },
            {
              label: 'Decided',
              value: `${String(total - counts.undecided)} of ${String(total)}`,
              detail: `${String(counts.released)} released, ${String(counts.unreleased)} private`,
            },
          ]}
        />
        <Meter
          label="Awarded against budget"
          value={list.awarded.amountMinor}
          max={list.round.budget.amountMinor}
          tone={over > 0 ? 'danger' : 'accent'}
          valueText={budgetWords(list)}
        />
        {over > 0 && (
          <Notice tone="warning" title="The awards are over the round's budget">
            You can still record and release them. Check the amounts before you release.
          </Notice>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <FilterTabs<Filter>
          label="Show submissions"
          options={[
            { value: 'all', label: 'All', count: total },
            { value: 'undecided', label: 'No decision', count: counts.undecided },
            { value: 'accepted', label: 'Accepted', count: counts.accepted },
            { value: 'waitlisted', label: 'Waitlisted', count: counts.waitlisted },
            { value: 'declined', label: 'Declined', count: counts.declined },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <BulkActionBar
          count={chosen.length}
          noun={noun}
          onClear={() => {
            setSelected(new Set());
          }}
        >
          <Button
            disabled={!chosen.some((row) => !isReleased(row))}
            onClick={() => {
              setOpen({ kind: 'many' });
            }}
          >
            Record decisions
          </Button>
        </BulkActionBar>
        <DecisionsTable
          rows={list.submissions.filter((row) => matches(row, filter))}
          selection={{
            selected,
            onSelectedChange: setSelected,
            label: (row) => `Select ${row.organisation.name}`,
          }}
          empty={
            <EmptyState title="No submissions here">
              <p>No submission has this outcome yet. Choose another filter to see the rest.</p>
            </EmptyState>
          }
          onRecord={(row) => {
            setOpen({ kind: 'one', submissionId: row.submissionId });
          }}
          onPreview={(row) => {
            setOpen({ kind: 'email', submissionId: row.submissionId });
          }}
          onHelp={onHelp}
        />
      </div>
      <DecisionDialog
        open={open?.kind === 'one'}
        onOpenChange={close}
        row={open?.kind === 'one' ? current : null}
        range={list.round}
        onRecorded={(row) => {
          setOpen(null);
          void refreshed(
            `Decision recorded for ${row.organisation.name}. Only staff can see it.`,
            false,
          );
        }}
      />
      <BulkDecisionDialog
        open={open?.kind === 'many'}
        onOpenChange={close}
        roundId={roundId}
        chosen={chosen}
        range={list.round}
        onRecorded={(recorded) => {
          setOpen(null);
          setSelected(new Set());
          void refreshed(
            `${countOf(recorded, 'decision')} recorded. Only staff can see ${recorded === 1 ? 'it' : 'them'}.`,
            true,
          );
        }}
      />
      <EmailDialog
        submission={
          open?.kind === 'email' && current
            ? { id: current.submissionId, name: current.organisation.name }
            : null
        }
        onClose={() => {
          setOpen(null);
        }}
      />
    </>
  );
}

function RoundDecisions({ roundId }: { roundId: string }) {
  const canRelease = useCan('grants.decisions.release');
  const [help, setHelp] = useState(false);
  const { state, retry } = useLoad(loadDecisionPage, roundId);
  const loaded = state.status === 'ready' ? state.value : null;

  return (
    <>
      <PageHeader
        breadcrumbs={
          loaded
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                ...(loaded.programme
                  ? [{ label: loaded.programme.title, to: programmePath(loaded.programme.id) }]
                  : []),
                { label: loaded.list.round.title, to: roundPath(roundId) },
                { label: 'Decisions' },
              ]
            : undefined
        }
        title="Decisions"
        description={`Record each submission's outcome${loaded ? ` in ${loaded.list.round.title}` : ''}, check what it comes to against the budget, then release the decisions to applicants.`}
        actions={
          <>
            <Button
              onClick={() => {
                setHelp(true);
              }}
            >
              Keyboard shortcuts
            </Button>
            {canRelease && (
              <Link to={releasePath(roundId)} className={buttonClassName('primary')}>
                Release decisions
              </Link>
            )}
          </>
        }
      />
      <WhenLoaded state={state} label="Loading decisions" retry={retry}>
        {({ list }) => (
          <Decisions
            key={roundId}
            roundId={roundId}
            initial={list}
            onHelp={() => {
              setHelp(true);
            }}
          />
        )}
      </WhenLoaded>
      <ShortcutsDialog
        open={help}
        onOpenChange={setHelp}
        groups={shortcuts}
        description="These work when a row of the table has focus. Press Tab to reach the table, then Tab again to reach its first row."
      />
    </>
  );
}

/** A round's submissions with their scores and decisions, to record singly or in bulk and to check against the budget. */
export default function DecisionsPage() {
  const roundId = useParam('roundId');
  return (
    <Gate
      permission="grants.decisions.record"
      heading="Decisions"
      title="You cannot record decisions"
    >
      <RoundDecisions roundId={roundId} />
    </Gate>
  );
}
