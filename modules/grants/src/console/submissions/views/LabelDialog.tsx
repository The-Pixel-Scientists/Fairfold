// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Checkbox, Dialog, EmptyState, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { MAX_TRIAGE_SUBMISSIONS, triageMessages } from '../../../contracts/index.ts';
import type { Label } from '../../../contracts/index.ts';
import { problemLines } from '../../assessment/problems.ts';
import { countOf } from '../words.tsx';
import { changeLabelsOf, loadLabels } from './loaders.ts';
import { LabelChip } from './LabelChip.tsx';

export type LabelMode = 'add' | 'remove';

const words = {
  add: { title: 'Add labels', done: 'Labels added to' },
  remove: { title: 'Remove labels', done: 'Labels removed from' },
} as const;

interface FormProps {
  mode: LabelMode;
  submissionIds: readonly string[];
  labels: readonly Label[];
  onClose: () => void;
  onChanged: (message: string) => void;
}

function LabelForm({ mode, submissionIds, labels, onClose, onChanged }: FormProps) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string[]>([]);
  // An archived label cannot be added again, but it can still be taken off.
  const offered = mode === 'add' ? labels.filter(({ archived }) => !archived) : labels;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (chosen.size === 0) {
      setFailure([triageMessages.chooseLabel]);
      return;
    }
    setPending(true);
    setFailure([]);
    try {
      const ids = [...chosen];
      const { changed } = await changeLabelsOf(
        submissionIds,
        mode === 'add' ? ids : [],
        mode === 'remove' ? ids : [],
      );
      onChanged(
        changed === 0
          ? 'No changes needed. Every submission was already as asked.'
          : `${words[mode].done} ${countOf(changed)}.`,
      );
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setPending(false);
    }
  }

  if (offered.length === 0) {
    return (
      <EmptyState
        title={mode === 'add' ? 'No labels to add' : 'No labels to remove'}
        headingLevel="h3"
      >
        <p>A programme manager creates labels on the Labels page. They then appear here.</p>
      </EmptyState>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className="flex flex-col gap-4"
    >
      {failure.length > 0 && (
        <div role="alert" className="rounded-md border border-danger p-3">
          <p className="font-medium text-danger">{failure.join(' ')}</p>
        </div>
      )}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-body font-medium text-ink">Labels</legend>
        {offered.map((label) => (
          <div key={label.id} className="flex items-center gap-2">
            <Checkbox
              label={label.name + (label.archived ? ' (archived)' : '')}
              checked={chosen.has(label.id)}
              onCheckedChange={(checked) => {
                const next = new Set(chosen);
                if (checked) next.add(label.id);
                else next.delete(label.id);
                setChosen(next);
              }}
            />
            <LabelChip label={label} />
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" aria-disabled={pending || undefined}>
          {words[mode].title}
        </Button>
      </div>
    </form>
  );
}

export interface LabelDialogProps {
  open: boolean;
  mode: LabelMode;
  onOpenChange: (open: boolean) => void;
  /** The submissions chosen. The server changes all of them or none. */
  submissionIds: readonly string[];
  onChanged: (message: string) => void;
}

function Labels(props: Omit<FormProps, 'labels'>) {
  const { state, retry } = useLoad(loadLabels);
  return (
    <WhenLoaded state={state} label="Loading labels" retry={retry}>
      {({ labels }) => <LabelForm labels={labels} {...props} />}
    </WhenLoaded>
  );
}

/**
 * Adds labels to, or removes them from, the chosen submissions in one change.
 * Over the cap it says how many to deselect and sends nothing; if the server
 * refuses, nothing changes and the choice stays.
 */
export function LabelDialog({
  open,
  mode,
  onOpenChange,
  submissionIds,
  onChanged,
}: LabelDialogProps) {
  const over = submissionIds.length - MAX_TRIAGE_SUBMISSIONS;
  const close = () => {
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={words[mode].title}
      description={`Choose the labels for ${countOf(submissionIds.length)}. Nothing changes unless every one can.`}
    >
      {over > 0 ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-body text-ink">
            A change takes at most {MAX_TRIAGE_SUBMISSIONS} submissions. Deselect {countOf(over)} to
            continue.
          </p>
          <div className="flex justify-end">
            <Button variant="primary" data-autofocus onClick={close}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <Labels mode={mode} submissionIds={submissionIds} onClose={close} onChanged={onChanged} />
      )}
    </Dialog>
  );
}
