// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import { Button, Dialog, FormField, Select, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import type { SubmissionSummary } from '../../contracts/index.ts';
import { loadStages, moveToStage } from './loaders.ts';
import { countOf } from './words.tsx';

/** What a move did, for the page to report. */
export interface Moved {
  moved: number;
  /** How many were chosen. The rest were already in the stage. */
  count: number;
  stageName: string;
}

/** A submission the move was refused for, and why. */
interface Refusal {
  submission: SubmissionSummary;
  message: string;
}

const INDEX = /^body\.submissionIds\.(\d+)$/;
const UNEXPECTED = 'Something went wrong. Try again.';

/** The submissions a refused move names, from the API's field paths. */
function refusals(error: unknown, selected: readonly SubmissionSummary[]): Refusal[] {
  if (!(error instanceof ProblemError)) return [];
  return error.errors.flatMap(({ field, message }) => {
    const submission = selected[Number(INDEX.exec(field)?.[1])];
    return submission === undefined ? [] : [{ submission, message }];
  });
}

interface MoveFormProps {
  selected: readonly SubmissionSummary[];
  stages: readonly { id: string; name: string }[];
  onClose: () => void;
  onMoved: (moved: Moved) => void;
  /** Takes the named submissions out of the selection. */
  onExclude: (ids: readonly string[]) => void;
}

function MoveForm({ selected, stages, onClose, onMoved, onExclude }: MoveFormProps) {
  const [stageId, setStageId] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; refused: Refusal[] } | null>(null);
  const stage = stages.find(({ id }) => id === stageId);
  const already = selected.filter((submission) => submission.stage.id === stageId).length;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || stage === undefined) return;
    setPending(true);
    setFailure(null);
    try {
      const { moved } = await moveToStage(
        stage.id,
        selected.map(({ id }) => id),
      );
      onMoved({ moved, count: selected.length, stageName: stage.name });
    } catch (error) {
      setFailure({
        message: error instanceof ProblemError ? error.detail : UNEXPECTED,
        refused: refusals(error, selected),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-4"
    >
      {failure && (
        <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger p-3">
          <p className="font-medium text-danger">{failure.message}</p>
          {failure.refused.length > 0 && (
            <>
              <ul className="list-disc pl-5 text-body text-ink">
                {failure.refused.map(({ submission, message }) => (
                  <li key={submission.id}>
                    <span className="font-medium">{submission.organisation.name}.</span> {message}
                  </li>
                ))}
              </ul>
              <Button
                className="self-start"
                onClick={() => {
                  onExclude(failure.refused.map(({ submission }) => submission.id));
                  setFailure(null);
                }}
              >
                Remove these from the selection
              </Button>
            </>
          )}
        </div>
      )}
      <FormField
        label="Stage"
        hint={
          already > 0
            ? `${countOf(already)} already in ${stage?.name ?? 'it'} will stay there.`
            : undefined
        }
      >
        <Select
          value={stageId}
          onChange={(event) => {
            setStageId(event.currentTarget.value);
          }}
        >
          <option value="">Choose a stage</option>
          {stages.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          aria-disabled={stage === undefined || pending || undefined}
        >
          {stage === undefined
            ? 'Move to stage'
            : `Move ${countOf(selected.length)} to ${stage.name}`}
        </Button>
      </div>
    </form>
  );
}

function RoundMove({ roundId, ...form }: Omit<MoveFormProps, 'stages'> & { roundId: string }) {
  const { state, retry } = useLoad(loadStages, roundId);
  return (
    <WhenLoaded state={state} label="Loading stages" retry={retry}>
      {({ stages }) => <MoveForm stages={stages} {...form} />}
    </WhenLoaded>
  );
}

export interface MoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: readonly SubmissionSummary[];
  onMoved: (moved: Moved) => void;
  onExclude: (ids: readonly string[]) => void;
}

/**
 * Moves the selected submissions into one stage of their round, all or
 * none. The button says the stage and the count, so pressing it is the
 * confirmation. If the API refuses, the dialog names each submission it
 * refused and why, and offers to take them out of the selection.
 */
export function MoveDialog({ open, onOpenChange, selected, onMoved, onExclude }: MoveDialogProps) {
  const rounds = new Set(selected.map(({ round }) => round.id));
  const [first] = selected;
  const close = () => {
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Move to stage"
      description={
        rounds.size > 1
          ? 'These submissions are in different rounds, and each round has its own stages.'
          : `Choose the stage to move ${countOf(selected.length)} to. Nothing moves unless every one can.`
      }
    >
      {rounds.size > 1 || first === undefined ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink">
            Filter the list by round, select the submissions again and move them round by round.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" data-autofocus onClick={close}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <RoundMove
          roundId={first.round.id}
          selected={selected}
          onClose={close}
          onMoved={onMoved}
          onExclude={onExclude}
        />
      )}
    </Dialog>
  );
}
