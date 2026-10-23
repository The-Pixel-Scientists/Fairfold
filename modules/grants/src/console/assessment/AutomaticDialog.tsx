// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, FormField, Select } from '@pixel-scientists/ui';
import { useEffect, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';

import { MAX_REVIEWERS_PER_SUBMISSION } from '../../contracts/index.ts';
import type { AutomaticAssignResult } from '../../contracts/index.ts';
import { assignAutomatically } from './loaders.ts';
import { problemLines } from './problems.ts';
import type { AssignTarget } from './target.ts';
import { countOf } from './words.ts';

const COUNTS = Array.from({ length: MAX_REVIEWERS_PER_SUBMISSION }, (_, index) => index + 1);

export interface AutomaticSubmission {
  id: string;
  /** What to call it where it could not be filled. */
  name: string;
}

/** What assigning did, in a sentence for the page to keep. */
export function summaryOf({ assigned, unfilled }: AutomaticAssignResult): string {
  const short =
    unfilled.length === 0
      ? ''
      : ` ${countOf(unfilled.length, 'submission')} could not get all the reviewers asked for.`;
  return `${countOf(assigned, 'review')} assigned.${short}`;
}

function Result({
  result,
  submissions,
}: {
  result: AutomaticAssignResult;
  submissions: readonly AutomaticSubmission[];
}) {
  const status = useRef<HTMLDivElement>(null);
  useEffect(() => {
    status.current?.focus();
  }, []);
  const nameOf = (id: string) => submissions.find((item) => item.id === id)?.name ?? 'A submission';
  return (
    <div
      ref={status}
      role="status"
      tabIndex={-1}
      className="flex flex-col gap-3 text-body text-ink"
    >
      <p className="font-semibold">{countOf(result.assigned, 'review')} assigned.</p>
      {result.unfilled.length === 0 ? (
        <p>Every submission has the reviewers you asked for.</p>
      ) : (
        <>
          <p>
            {countOf(result.unfilled.length, 'submission')} could not get all the reviewers asked
            for, because the pool has no one else free. Add reviewers to the pool, or assign them by
            hand from the submission.
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {result.unfilled.map(({ submissionId, missing }) => (
              <li key={submissionId}>
                <span className="font-medium">{nameOf(submissionId)}</span> needs{' '}
                {countOf(missing, 'more reviewer')}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export interface AutomaticDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stage the submissions are in, or null when they are not all in one. */
  target: AssignTarget | null;
  submissions: readonly AutomaticSubmission[];
  /** Called once the dialog closes after assigning, with what was done. */
  onDone: (result: AutomaticAssignResult) => void;
}

/**
 * Asks how many reviewers each submission should have, assigns them from the
 * pool by fewest open reviews, and reports what was assigned and what could
 * not be. The button says the counts, so pressing it is the confirmation.
 */
export function AutomaticDialog({
  open,
  onOpenChange,
  target,
  submissions,
  onDone,
}: AutomaticDialogProps) {
  const [count, setCount] = useState('2');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<readonly string[]>([]);
  const [result, setResult] = useState<AutomaticAssignResult | null>(null);

  function change(next: boolean) {
    if (!next) {
      if (result !== null) onDone(result);
      setResult(null);
      setFailure([]);
    }
    onOpenChange(next);
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || target === null) return;
    setPending(true);
    setFailure([]);
    try {
      setResult(
        await assignAutomatically(
          target.stageId,
          submissions.map(({ id }) => id),
          Number(count),
        ),
      );
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={change}
      title="Assign automatically"
      description={
        target === null
          ? 'Assignments belong to a stage, and these submissions are not all in the same one.'
          : `Each of the ${countOf(submissions.length, 'submission')} gets the reviewers in the pool who have the fewest open reviews. Anyone already assigned, or who declared a conflict, is skipped.`
      }
    >
      {target === null ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink">
            Filter the list by stage, select the submissions again and assign them stage by stage.
          </p>
          <div className="flex justify-end">
            <Button
              variant="primary"
              data-autofocus
              onClick={() => {
                change(false);
              }}
            >
              Close
            </Button>
          </div>
        </div>
      ) : result !== null ? (
        <>
          <Result result={result} submissions={submissions} />
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                change(false);
              }}
            >
              Close
            </Button>
          </div>
        </>
      ) : (
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
          <FormField
            label="Reviewers for each submission"
            hint="A submission that already has some of them is topped up, not given more."
          >
            <Select
              data-autofocus
              value={count}
              onChange={(event) => {
                setCount(event.currentTarget.value);
              }}
            >
              {COUNTS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => {
                change(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" aria-disabled={pending || undefined}>
              Assign {countOf(Number(count), 'reviewer')} to each
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
