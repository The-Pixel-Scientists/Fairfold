// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  CheckboxGroup,
  DataTable,
  EmptyState,
  Link,
  PageHeader,
  Panel,
  Stats,
  useLoad,
  WhenLoaded,
  buttonClassName,
} from '@pixel-scientists/ui';
import type { Column } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import { MAX_POOL_ADD } from '../../contracts/index.ts';
import type { ReviewerCandidates, ReviewerPool } from '../../contracts/index.ts';
import { ConfirmDialog } from '../forms/ConfirmDialog.tsx';
import { PROGRAMMES_PATH, programmePath, roundPath } from '../programme/paths.ts';
import { SUBMISSIONS_PATH } from '../submissions/paths.ts';
import { addToPool, loadPoolPage, loadRoundNames, removeFromPool } from './loaders.ts';
import type { PoolPage } from './loaders.ts';
import { AssignPage, useParam } from './Page.tsx';
import { spreadPath } from './paths.ts';
import { problemLines } from './problems.ts';
import { countOf, nameOf } from './words.ts';

type PoolReviewer = ReviewerPool['reviewers'][number];

const load = async (roundId: string) => {
  const [page, names] = await Promise.all([loadPoolPage(roundId), loadRoundNames(roundId)]);
  return { page, names };
};

function poolColumns(onRemove: (reviewer: PoolReviewer) => void): readonly Column<PoolReviewer>[] {
  return [
    {
      key: 'name',
      header: 'Reviewer',
      rowHeader: true,
      cell: (reviewer) => <span className="font-medium">{nameOf(reviewer.name)}</span>,
    },
    {
      key: 'open',
      header: 'Open reviews',
      align: 'end',
      cell: (reviewer) => <span className="tabular-nums">{reviewer.openAssignments}</span>,
    },
    {
      key: 'all',
      header: 'All reviews',
      align: 'end',
      cell: (reviewer) => <span className="tabular-nums">{reviewer.assignments}</span>,
    },
    {
      key: 'action',
      header: <span className="sr-only">Action</span>,
      align: 'end',
      cell: (reviewer) =>
        reviewer.assignments === 0 ? (
          <Button
            variant="quiet"
            onClick={() => {
              onRemove(reviewer);
            }}
          >
            Remove<span className="sr-only"> {nameOf(reviewer.name)} from the pool</span>
          </Button>
        ) : (
          <span className="text-sm text-muted">Has reviews</span>
        ),
    },
  ];
}

function AddReviewers({
  candidates,
  onAdd,
  failure,
}: {
  candidates: ReviewerCandidates['members'];
  onAdd: (membershipIds: readonly string[]) => Promise<boolean>;
  failure: readonly string[];
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const tooMany = chosen.length > MAX_POOL_ADD;

  if (candidates.length === 0) {
    return (
      <p className="max-w-prose text-body text-muted">
        Everyone who can review is already in the pool. To add someone else, invite them from Team
        with the Reviewer role, then come back.
      </p>
    );
  }

  async function add() {
    if (pending || chosen.length === 0) return;
    setPending(true);
    if (await onAdd(chosen)) setChosen([]);
    setPending(false);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
      className="flex flex-col gap-3"
    >
      <CheckboxGroup
        legend="Members who can review"
        name="reviewers"
        hint={`Choose up to ${String(MAX_POOL_ADD)}. They can then be assigned to submissions in this round.`}
        values={chosen}
        onValuesChange={setChosen}
        options={candidates.map((member) => ({
          value: member.membershipId,
          label: nameOf(member.name),
        }))}
        error={tooMany ? `Choose no more than ${String(MAX_POOL_ADD)} at a time` : undefined}
      />
      {failure.length > 0 && (
        <div role="alert" className="rounded-md border-2 border-danger bg-danger-soft p-3">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-body text-danger">
            {failure.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <Button
          type="submit"
          variant="primary"
          aria-disabled={chosen.length === 0 || tooMany || pending || undefined}
        >
          {chosen.length === 0 ? 'Add to the pool' : `Add ${countOf(chosen.length, 'reviewer')}`}
        </Button>
      </div>
    </form>
  );
}

function Body({ roundId, initial }: { roundId: string; initial: PoolPage }) {
  const [page, setPage] = useState(initial);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState<readonly string[]>([]);
  const [removing, setRemoving] = useState<PoolReviewer | null>(null);
  const [removeFailure, setRemoveFailure] = useState<readonly string[]>([]);
  const status = useRef<HTMLParagraphElement>(null);
  const open = page.pool.reduce((sum, reviewer) => sum + reviewer.openAssignments, 0);

  useEffect(() => {
    if (notice !== '') status.current?.focus();
  }, [notice]);

  async function add(membershipIds: readonly string[]): Promise<boolean> {
    setFailure([]);
    try {
      await addToPool(roundId, membershipIds);
      setPage(await loadPoolPage(roundId));
      setNotice(`${countOf(membershipIds.length, 'reviewer')} added to the pool.`);
      return true;
    } catch (error) {
      setFailure(problemLines(error));
      return false;
    }
  }

  async function remove(reviewer: PoolReviewer) {
    setRemoveFailure([]);
    try {
      await removeFromPool(roundId, reviewer.membershipId);
      setPage(await loadPoolPage(roundId));
      setNotice(`${nameOf(reviewer.name)} removed from the pool.`);
      setRemoving(null);
    } catch (error) {
      setRemoveFailure(problemLines(error));
    }
  }

  return (
    <>
      <Stats
        label="Reviewers in this round"
        items={[
          { label: 'In the pool', value: page.pool.length },
          { label: 'Open reviews', value: open, detail: 'Assigned and not yet submitted' },
          {
            label: 'Could be added',
            value: page.candidates.length,
            detail: 'Members who can review',
          },
        ]}
      />
      <p
        ref={status}
        role="status"
        tabIndex={-1}
        className="rounded-md border border-divider bg-success-soft px-3 py-2 text-body text-ink empty:hidden"
      >
        {notice}
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <section aria-labelledby="pool-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="pool-heading" className="text-lg font-semibold tracking-tight text-ink">
            Who can be assigned
          </h2>
          {page.pool.length === 0 ? (
            <EmptyState title="No reviewers in this round yet" headingLevel="h3">
              <p>
                Add members who can review from the list beside this one. Once they are in the pool,
                you can assign them to submissions.
              </p>
            </EmptyState>
          ) : (
            <>
              <DataTable
                caption="Reviewers in the pool"
                captionHidden
                columns={poolColumns((reviewer) => {
                  setRemoveFailure([]);
                  setRemoving(reviewer);
                })}
                rows={page.pool}
                rowKey={(reviewer) => reviewer.membershipId}
              />
              <p className="text-sm text-muted">
                A reviewer with reviews assigned cannot be removed. Remove their assignments from
                each submission first.
              </p>
            </>
          )}
        </section>
        <Panel title="Add reviewers" headingLevel="h2">
          <AddReviewers candidates={page.candidates} onAdd={add} failure={failure} />
        </Panel>
      </div>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${nameOf(removing?.name ?? null)} from the pool?`}
        description="They will no longer be offered for submissions in this round. You can add them again later."
        confirm="Remove from the pool"
        cancel="Keep in the pool"
        problems={removeFailure}
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        onClose={() => {
          setRemoving(null);
        }}
      />
    </>
  );
}

function Reviewers({ roundId }: { roundId: string }) {
  const { state, retry } = useLoad(load, roundId);
  const names = state.status === 'ready' ? state.value.names : null;
  const submissions = `${SUBMISSIONS_PATH}?roundId=${roundId}`;

  return (
    <>
      <PageHeader
        breadcrumbs={
          names
            ? [
                { label: 'Programmes', to: PROGRAMMES_PATH },
                { label: names.programme.title, to: programmePath(names.programme.id) },
                { label: names.round.title, to: roundPath(roundId) },
                { label: 'Reviewers' },
              ]
            : undefined
        }
        title="Reviewers"
        description={
          names
            ? `The pool of people who review submissions to ${names.round.title}. Only members with the Reviewer role can be added.`
            : 'The pool of people who review submissions to this round. Only members with the Reviewer role can be added.'
        }
        actions={
          <>
            <Link to={submissions} className={buttonClassName()}>
              Submissions in this round
            </Link>
            <Link to={spreadPath(roundId)} className={buttonClassName()}>
              Score spread
            </Link>
          </>
        }
      />
      <WhenLoaded state={state} label="Loading reviewers" retry={retry}>
        {({ page }) => <Body key={roundId} roundId={roundId} initial={page} />}
      </WhenLoaded>
    </>
  );
}

/** A round's reviewer pool: who can be assigned, how much each has open, and who to add or remove. */
export default function ReviewersPage() {
  return (
    <AssignPage title="Reviewers">
      <Reviewers roundId={useParam('roundId')} />
    </AssignPage>
  );
}
