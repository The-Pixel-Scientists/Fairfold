// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BulkActionBar,
  Button,
  buttonClassName,
  EmptyState,
  Link,
  LoadingState,
  PageHeader,
  ShortcutsDialog,
  useCan,
  useLoad,
  useNavigate,
  useSearch,
} from '@pixel-scientists/ui';
import type { ShortcutGroup } from '@pixel-scientists/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { submissionQuerySchema } from '../../contracts/index.ts';
import type { SubmissionPage, SubmissionQuery } from '../../contracts/index.ts';
import { AssignActions } from '../assessment/AssignActions.tsx';
import { reviewersPath, spreadPath } from '../assessment/paths.ts';
import { Filters } from './Filters.tsx';
import { loadProgrammes } from './loaders.ts';
import { MoveDialog } from './MoveDialog.tsx';
import type { Moved } from './MoveDialog.tsx';
import { submissionPath, submissionsPath } from './paths.ts';
import { searchOf, withCursor, withFilter } from './query.ts';
import { ReadPage } from './ReadPage.tsx';
import { SubmissionTable } from './SubmissionTable.tsx';
import { useSubmissionPage } from './useSubmissionPage.ts';
import { countOf } from './words.tsx';

const shortcuts: readonly ShortcutGroup[] = [
  {
    title: 'In the table',
    shortcuts: [
      { keys: ['Arrow up', 'Arrow down'], does: 'Move to the row above or below' },
      { keys: ['Home', 'End'], does: 'Move to the first or last row' },
      { keys: ['Enter'], does: 'Open the submission' },
      { keys: ['Space'], does: 'Select or deselect the submission' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
];

const noun = { one: 'submission', other: 'submissions' };

interface ResultsProps {
  query: SubmissionQuery;
  page: SubmissionPage;
  /** True when the person turned to this page, so it starts at its top. */
  turnedHere: boolean;
  /** Called with the address of the page the person is turning to. */
  onTurn: (search: string) => void;
  /** Called once the page has taken focus, so going Back to it later does not. */
  onArrived: () => void;
  reload: () => void;
  onShortcuts: () => void;
}

/** One page of the list. It is remounted for each address, so a selection never outlives its page. */
function Results({
  query,
  page,
  turnedHere,
  onTurn,
  onArrived,
  reload,
  onShortcuts,
}: ResultsProps) {
  const navigate = useNavigate();
  const canMove = useCan('grants.applications.triage');
  const canAssign = useCan('grants.reviews.assign');
  const canChoose = canMove || canAssign;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [notice, setNotice] = useState('');
  const summary = useRef<HTMLParagraphElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const search = searchOf(query);
  const first = searchOf(withCursor(query, undefined));
  const next = searchOf(withCursor(query, page.nextCursor ?? undefined));
  const chosen = page.submissions.filter(({ id }) => selected.has(id));

  useEffect(() => {
    if (!turnedHere) return;
    summary.current?.focus();
    onArrived();
  }, [turnedHere, onArrived]);

  useEffect(() => {
    if (notice !== '') status.current?.focus();
  }, [notice]);

  function moved({ moved: count, count: total, stageName }: Moved) {
    const already = total - count;
    setNotice(
      `${countOf(count)} moved to ${stageName}.` +
        (already > 0 ? ` ${countOf(already)} already in ${stageName} stayed there.` : ''),
    );
    setSelected(new Set());
    setMoving(false);
    reload();
  }

  return (
    <>
      <p ref={summary} tabIndex={-1} aria-live="polite" className="text-body text-muted">
        {query.cursor === undefined && page.nextCursor === null
          ? countOf(page.total)
          : `Showing ${String(page.submissions.length)} on this page, ${countOf(page.total)} in all`}
      </p>
      {canChoose && (
        <BulkActionBar
          count={chosen.length}
          noun={noun}
          onClear={() => {
            setSelected(new Set());
          }}
        >
          {canMove && (
            <Button
              disabled={chosen.length === 0}
              onClick={() => {
                setMoving(true);
              }}
            >
              Move to stage
            </Button>
          )}
          <AssignActions
            chosen={chosen}
            onDone={(message) => {
              setNotice(message);
              setSelected(new Set());
            }}
          />
        </BulkActionBar>
      )}
      <p
        ref={status}
        role="status"
        tabIndex={-1}
        className="rounded-md border border-divider bg-success-soft px-3 py-2 text-body text-ink empty:hidden"
      >
        {notice}
      </p>
      <SubmissionTable
        submissions={page.submissions}
        search={search}
        {...(canChoose && {
          selection: {
            selected,
            onSelectedChange: setSelected,
            label: (submission) => `Select ${submission.organisation.name}`,
          },
        })}
        onOpen={(submission) => {
          navigate(submissionPath(submission.id, search));
        }}
        onHelp={onShortcuts}
      />
      <nav aria-label="Pages of submissions" className="flex flex-wrap items-center gap-2">
        {query.cursor !== undefined && (
          <Link
            to={submissionsPath(first)}
            className={buttonClassName()}
            onClick={() => {
              onTurn(first);
            }}
          >
            Back to the first page
          </Link>
        )}
        {page.nextCursor !== null && (
          <Link
            to={submissionsPath(next)}
            className={buttonClassName()}
            onClick={() => {
              onTurn(next);
            }}
          >
            Next page
          </Link>
        )}
      </nav>
      <MoveDialog
        open={moving && chosen.length > 0}
        onOpenChange={setMoving}
        selected={chosen}
        onMoved={moved}
        onExclude={(ids) => {
          setSelected(new Set([...selected].filter((id) => !ids.includes(id))));
        }}
      />
    </>
  );
}

function Submissions({ query }: { query: SubmissionQuery }) {
  const navigate = useNavigate();
  const { state, reload } = useSubmissionPage(query);
  const options = useLoad(loadProgrammes);
  const canAssign = useCan('grants.reviews.assign');
  const [help, setHelp] = useState(false);
  const [turnedTo, setTurnedTo] = useState<string | null>(null);
  const arrived = useCallback(() => {
    setTurnedTo(null);
  }, []);
  const search = searchOf(query);
  const filtered = search !== '';

  const go = (next: SubmissionQuery) => {
    navigate(submissionsPath(searchOf(next)));
  };
  const clear = () => {
    go({});
  };

  return (
    <>
      <PageHeader
        title="Submissions"
        description="Everything applicants have submitted, where each one stands and what needs doing next."
        actions={
          <>
            {canAssign && query.roundId !== undefined && (
              <>
                <Link to={reviewersPath(query.roundId)} className={buttonClassName()}>
                  Reviewers
                </Link>
                <Link to={spreadPath(query.roundId)} className={buttonClassName()}>
                  Score spread
                </Link>
              </>
            )}
            <Button
              onClick={() => {
                setHelp(true);
              }}
            >
              Keyboard shortcuts
            </Button>
          </>
        }
      />
      <Filters
        query={query}
        programmes={
          options.state.status === 'loading'
            ? null
            : options.state.status === 'ready'
              ? options.state.value
              : []
        }
        onChange={(change) => {
          go(withFilter(query, change));
        }}
        onClear={clear}
      />
      {state.status === 'loading' && (
        <LoadingState label="Loading submissions" className="rounded-lg bg-surface" />
      )}
      {state.status === 'failed' && (
        <EmptyState
          title="We could not load submissions"
          action={
            <div className="flex flex-wrap gap-2">
              <Button onClick={reload}>Try again</Button>
              {filtered && <Button onClick={clear}>Clear filters</Button>}
            </div>
          }
        >
          <p>{state.message}</p>
        </EmptyState>
      )}
      {state.status === 'ready' &&
        (state.value.submissions.length === 0 ? (
          <EmptyState
            title={filtered ? 'No submissions match these filters' : 'No submissions yet'}
            action={
              filtered ? (
                <Button onClick={clear}>Clear filters</Button>
              ) : (
                <Link to="/" className={buttonClassName()}>
                  Go to programmes
                </Link>
              )
            }
          >
            <p>
              {filtered
                ? 'Every filter narrows the list, so a submission has to match all of them. Remove one, or clear them all to see every submission.'
                : 'Submissions appear here as soon as applicants send in their applications. Open a round and share its link to start receiving them.'}
            </p>
          </EmptyState>
        ) : (
          <Results
            key={search}
            query={query}
            page={state.value}
            turnedHere={turnedTo === search}
            onTurn={setTurnedTo}
            onArrived={arrived}
            reload={reload}
            onShortcuts={() => {
              setHelp(true);
            }}
          />
        ))}
      <ShortcutsDialog
        open={help}
        onOpenChange={setHelp}
        groups={shortcuts}
        description="These work when a row of the table has focus. Press Tab to reach the table, then Tab again to reach its first row."
      />
    </>
  );
}

function InvalidAddress() {
  return (
    <>
      <PageHeader title="Submissions" />
      <EmptyState
        title="These filters are not valid"
        action={
          <Link to={submissionsPath()} className={buttonClassName()}>
            Show every submission
          </Link>
        }
      >
        <p>The address has a filter that does not exist or a value it cannot use.</p>
      </EmptyState>
    </>
  );
}

/** Every submission, filtered, a page at a time. The filters and the page are in the address. */
export default function SubmissionsPage() {
  const search = useSearch(submissionQuerySchema);
  return (
    <ReadPage title="Submissions">
      {search.success ? <Submissions query={search.data} /> : <InvalidAddress />}
    </ReadPage>
  );
}
