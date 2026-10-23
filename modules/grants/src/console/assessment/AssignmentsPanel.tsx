// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  buttonClassName,
  Link,
  LoadingState,
  Panel,
  Tag,
  useCan,
  useLoad,
} from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';

import type { Assignment, Submission } from '../../contracts/index.ts';
import { ConfirmDialog } from '../forms/ConfirmDialog.tsx';
import { AssignDialog } from './AssignDialog.tsx';
import type { Assigned } from './AssignDialog.tsx';
import { loadAssignments, unassign } from './loaders.ts';
import { reviewersPath, spreadPath } from './paths.ts';
import { problemLines } from './problems.ts';
import { targetOf } from './target.ts';
import { assignmentTones, assignmentWords, countOf, nameOf } from './words.ts';

type Placed = Pick<Submission, 'id' | 'status' | 'round' | 'stage'>;

function Body({ submission, initial }: { submission: Placed; initial: readonly Assignment[] }) {
  const [assignments, setAssignments] = useState(initial);
  const [notice, setNotice] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const [failure, setFailure] = useState<readonly string[]>([]);
  const target = targetOf([submission]);
  const open = submission.status === 'submitted';
  // A conflicted reviewer cannot be assigned again, and an assigned one already is.
  const taken = new Set(assignments.map(({ reviewer }) => reviewer.membershipId));

  const status = useRef<HTMLParagraphElement>(null);

  // A removed row takes its button, and the focus, with it. The status line is a stable place to land.
  useEffect(() => {
    if (notice !== '') status.current?.focus();
  }, [notice]);

  // The list and the notice change in one render, so the notice is focused once the old row has gone.
  async function reload(message: string) {
    const { assignments: next } = await loadAssignments(submission.id);
    setAssignments(next);
    setNotice(message);
  }

  async function assigned({ assigned: count }: Assigned) {
    setAssigning(false);
    await reload(`${countOf(count, 'review')} assigned.`);
  }

  async function remove(assignment: Assignment) {
    setFailure([]);
    try {
      await unassign(assignment.id);
      setRemoving(null);
      await reload(`${nameOf(assignment.reviewer.name)} removed from this submission.`);
    } catch (error) {
      setFailure(problemLines(error));
    }
  }

  return (
    <>
      <p ref={status} role="status" tabIndex={-1} className="text-body text-ink empty:hidden">
        {notice}
      </p>
      {assignments.length === 0 ? (
        <p className="text-body text-muted">
          {open
            ? 'No reviewers are assigned yet. Assign reviewers to start scoring.'
            : 'This submission was withdrawn, so it cannot be assigned.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider">
          {assignments.map((assignment) => (
            <li
              key={assignment.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-ink">{nameOf(assignment.reviewer.name)}</span>
                <span className="text-sm text-muted">{assignment.stage.name}</span>
              </span>
              <span className="flex items-center gap-2">
                <Tag tone={assignmentTones[assignment.status]}>
                  {assignmentWords(assignment.status)}
                </Tag>
                {assignment.status === 'assigned' && !assignment.scored && (
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setFailure([]);
                      setRemoving(assignment);
                    }}
                  >
                    Remove
                    <span className="sr-only"> {nameOf(assignment.reviewer.name)}</span>
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {open && (
          <Button
            variant="primary"
            onClick={() => {
              setAssigning(true);
            }}
          >
            Assign reviewers
          </Button>
        )}
        <Link to={reviewersPath(submission.round.id)} className={buttonClassName()}>
          Reviewer pool
        </Link>
        <Link to={spreadPath(submission.round.id)} className={buttonClassName()}>
          Score spread
        </Link>
      </div>
      <AssignDialog
        open={assigning}
        onOpenChange={setAssigning}
        target={target}
        submissionIds={[submission.id]}
        exclude={taken}
        onAssigned={(result) => {
          void assigned(result);
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${nameOf(removing?.reviewer.name ?? null)} from this submission?`}
        description="They have not scored it, so nothing is lost. You can assign them again later."
        confirm="Remove reviewer"
        cancel="Keep reviewer"
        problems={failure}
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

function Assignments({ submission }: { submission: Placed }) {
  const { state, retry } = useLoad(loadAssignments, submission.id);
  return (
    <Panel title="Reviewers">
      {state.status === 'loading' && <LoadingState label="Loading reviewers" />}
      {state.status === 'failed' && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body text-danger">{state.message}</p>
          <Button onClick={retry}>Try again</Button>
        </div>
      )}
      {state.status === 'ready' && (
        <Body submission={submission} initial={state.value.assignments} />
      )}
    </Panel>
  );
}

/** Who is assigned to review a submission, with a way to assign more. Only for someone who can assign reviewers. */
export function AssignmentsPanel({ submission }: { submission: Placed }) {
  return useCan('grants.reviews.assign') ? (
    <Assignments key={submission.id} submission={submission} />
  ) : null;
}
