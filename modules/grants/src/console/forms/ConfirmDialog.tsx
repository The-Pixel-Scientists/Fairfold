// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog } from '@pixel-scientists/ui';
import type { ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  /** Says what the person is about to do: "Publish version 2?" */
  title: string;
  /** Says what it changes and what it does not. */
  description: ReactNode;
  /** The button that does it. Name the action: "Publish version 2". */
  confirm: string;
  /** The button that closes the dialog and changes nothing: "Keep editing". */
  cancel: string;
  /** Marks an action that cannot be undone. */
  danger?: boolean;
  pending?: boolean;
  /** Why it failed, in the words of the server. */
  problems?: readonly string[];
  onConfirm: () => void;
  onClose: () => void;
}

/** Asks before a change that cannot be undone. Focus starts on the button that changes nothing. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirm,
  cancel,
  danger = false,
  pending = false,
  problems = [],
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      description={description}
      actions={
        <>
          <Button data-autofocus onClick={onClose}>
            {cancel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onConfirm();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      {problems.length > 0 && (
        <div role="alert" className="rounded-md border-2 border-danger bg-danger-soft p-4">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-body text-danger">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
