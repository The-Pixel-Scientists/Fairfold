// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Button,
  buttonClassName,
  CheckboxGroup,
  Dialog,
  Link,
  useLoad,
  WhenLoaded,
} from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { MAX_REVIEWERS_PER_SUBMISSION } from '../../contracts/index.ts';
import type { ReviewerPool } from '../../contracts/index.ts';
import { assign, loadPool } from './loaders.ts';
import { reviewersPath } from './paths.ts';
import { problemLines } from './problems.ts';
import type { AssignTarget } from './target.ts';
import { countOf, nameOf } from './words.ts';

/** What an assignment did, for the page to report. */
export interface Assigned {
  /** How many reviews were assigned. */
  assigned: number;
}

interface FormProps {
  target: AssignTarget;
  submissionIds: readonly string[];
  /** Reviewers to leave out, because the submission already has them. */
  exclude: ReadonlySet<string>;
  pool: ReviewerPool['reviewers'];
  onClose: () => void;
  onAssigned: (result: Assigned) => void;
}

function AssignForm({ target, submissionIds, exclude, pool, onClose, onAssigned }: FormProps) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<readonly string[]>([]);
  const offered = pool.filter((reviewer) => !exclude.has(reviewer.membershipId));
  const tooMany = chosen.length > MAX_REVIEWERS_PER_SUBMISSION;

  if (pool.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink">
          There are no reviewers in this round&apos;s pool yet. Add some first, then come back.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Link
            to={reviewersPath(target.roundId)}
            data-autofocus
            className={buttonClassName('primary')}
          >
            Set up reviewers
          </Link>
        </div>
      </div>
    );
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || chosen.length === 0 || tooMany) return;
    setPending(true);
    setFailure([]);
    try {
      const result = await assign(target.stageId, submissionIds, chosen);
      onAssigned(result);
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setPending(false);
    }
  }

  const to = submissionIds.length === 1 ? '' : ` to ${countOf(submissionIds.length, 'submission')}`;

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-4"
    >
      {failure.length > 0 && (
        <div role="alert" className="rounded-md border-2 border-danger bg-danger-soft p-3">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-body text-danger">
            {failure.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {offered.length === 0 ? (
        <p className="text-body text-ink">
          Every reviewer in the pool is already assigned. Add more reviewers to the pool to assign
          others.
        </p>
      ) : (
        <CheckboxGroup
          legend="Reviewers"
          name="reviewers"
          hint={`Choose up to ${String(MAX_REVIEWERS_PER_SUBMISSION)}.${
            submissionIds.length === 1 ? '' : ' Each one reviews every submission you chose.'
          }`}
          values={chosen}
          onValuesChange={setChosen}
          options={offered.map((reviewer) => ({
            value: reviewer.membershipId,
            label: (
              <>
                <span>{nameOf(reviewer.name)}</span>{' '}
                <span className="text-muted">
                  {countOf(reviewer.openAssignments, 'open review')}
                </span>
              </>
            ),
          }))}
          error={
            tooMany
              ? `Choose no more than ${String(MAX_REVIEWERS_PER_SUBMISSION)} reviewers`
              : undefined
          }
        />
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          aria-disabled={chosen.length === 0 || tooMany || pending || undefined}
        >
          {chosen.length === 0
            ? 'Assign reviewers'
            : `Assign ${countOf(chosen.length, 'reviewer')}${to}`}
        </Button>
      </div>
    </form>
  );
}

export interface AssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stage the submissions are in, or null when they are not all in one. */
  target: AssignTarget | null;
  submissionIds: readonly string[];
  /** Membership ids already assigned to the submission, when it is one. */
  exclude?: ReadonlySet<string>;
  onAssigned: (result: Assigned) => void;
}

const NONE: ReadonlySet<string> = new Set();

function PoolForm({ target, ...form }: Omit<FormProps, 'pool'>) {
  const { state, retry } = useLoad(loadPool, target.roundId);
  return (
    <WhenLoaded state={state} label="Loading reviewers" retry={retry}>
      {({ reviewers }) => <AssignForm target={target} pool={reviewers} {...form} />}
    </WhenLoaded>
  );
}

/**
 * Assigns chosen reviewers from the round's pool to the submissions, all or
 * none. The submissions must all be at one stage, because an assignment
 * belongs to a stage. The button says how many reviewers and submissions, so
 * pressing it is the confirmation.
 */
export function AssignDialog({
  open,
  onOpenChange,
  target,
  submissionIds,
  exclude = NONE,
  onAssigned,
}: AssignDialogProps) {
  const close = () => {
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Assign reviewers"
      description={
        target === null
          ? 'Assignments belong to a stage, and these submissions are not all in the same one.'
          : `Choose who reviews ${submissionIds.length === 1 ? 'this submission' : countOf(submissionIds.length, 'submission')} at ${target.stageName}. Nothing is assigned unless every choice can be.`
      }
    >
      {target === null ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink">
            Filter the list by stage, select the submissions again and assign them stage by stage.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" data-autofocus onClick={close}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <PoolForm
          target={target}
          submissionIds={submissionIds}
          exclude={exclude}
          onClose={close}
          onAssigned={onAssigned}
        />
      )}
    </Dialog>
  );
}
