// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, FormField, Select, useLoad, WhenLoaded } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { MAX_TRIAGE_SUBMISSIONS } from '../../../contracts/index.ts';
import { problemLines } from '../../assessment/problems.ts';
import { nameOf } from '../notes/words.ts';
import { countOf } from '../words.tsx';
import { changeOwnerOf, loadOwners } from './loaders.ts';

export type OwnerMode = 'assign' | 'clear';

const words = {
  assign: { title: 'Assign owner', done: 'Owner assigned to' },
  clear: { title: 'Clear owner', done: 'Owner cleared from' },
} as const;

interface FormProps {
  mode: OwnerMode;
  submissionIds: readonly string[];
  /** Who may own, as the server lists them. Empty when clearing. */
  members: readonly { membershipId: string; name: string | null }[];
  onClose: () => void;
  onChanged: (message: string) => void;
}

function OwnerForm({ mode, submissionIds, members, onClose, onChanged }: FormProps) {
  const [ownerId, setOwnerId] = useState('');
  const [pending, setPending] = useState(false);
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string[]>([]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (mode === 'assign' && ownerId === '') {
      setMissing(true);
      event.currentTarget.querySelector<HTMLSelectElement>('#owner')?.focus();
      return;
    }
    setPending(true);
    setFailure([]);
    try {
      const { changed } = await changeOwnerOf(submissionIds, mode === 'assign' ? ownerId : null);
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
      {mode === 'assign' && (
        <FormField
          id="owner"
          label="Owner"
          error={missing ? 'Choose a member to own the submissions.' : undefined}
        >
          <Select
            value={ownerId}
            onChange={(event) => {
              setOwnerId(event.currentTarget.value);
              setMissing(false);
            }}
          >
            <option value="">Choose a member</option>
            {members.map((member) => (
              <option key={member.membershipId} value={member.membershipId}>
                {nameOf(member.name)}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" aria-disabled={pending || undefined}>
          {words[mode].title}
        </Button>
      </div>
    </form>
  );
}

function Owners(props: Omit<FormProps, 'members'> & { askAbout: string }) {
  const { askAbout, ...form } = props;
  const { state, retry } = useLoad(loadOwners, askAbout);
  return (
    <WhenLoaded state={state} label="Loading members" retry={retry}>
      {({ members }) => <OwnerForm members={members} {...form} />}
    </WhenLoaded>
  );
}

export interface OwnerDialogProps {
  open: boolean;
  mode: OwnerMode;
  onOpenChange: (open: boolean) => void;
  /** The submissions chosen. The server changes all of them or none. */
  submissionIds: readonly string[];
  onChanged: (message: string) => void;
}

/**
 * Assigns, or clears, the owner of the chosen submissions in one change. The
 * members offered are the ones the server lists for the first submission:
 * everyone who can read applications, which is who may own one. Over the cap it
 * says how many to deselect and sends nothing.
 */
export function OwnerDialog({
  open,
  mode,
  onOpenChange,
  submissionIds,
  onChanged,
}: OwnerDialogProps) {
  const over = submissionIds.length - MAX_TRIAGE_SUBMISSIONS;
  const first = submissionIds[0];
  const close = () => {
    onOpenChange(false);
  };
  const form = { mode, submissionIds, onClose: close, onChanged };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={words[mode].title}
      description={`${mode === 'assign' ? 'Choose the owner' : 'Remove the owner'} for ${countOf(submissionIds.length)}. Nothing changes unless every one can.`}
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
      ) : mode === 'clear' || first === undefined ? (
        <OwnerForm members={[]} {...form} />
      ) : (
        <Owners askAbout={first} {...form} />
      )}
    </Dialog>
  );
}
