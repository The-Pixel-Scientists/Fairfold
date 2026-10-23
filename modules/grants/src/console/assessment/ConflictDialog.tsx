// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog } from '@pixel-scientists/ui';
import { useState } from 'react';

import { declare } from './loaders.ts';
import { problemLines } from './problems.ts';

export interface ConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  /** Called once the server has ended the assignment. */
  onDeclared: () => void;
}

/**
 * Declaring a conflict ends the assignment for good, so it asks first and
 * says what follows. Focus starts on the button that changes nothing.
 */
export function ConflictDialog({
  open,
  onOpenChange,
  assignmentId,
  onDeclared,
}: ConflictDialogProps) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<readonly string[]>([]);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setFailure([]);
    try {
      await declare(assignmentId);
      onDeclared();
    } catch (error) {
      setFailure(problemLines(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Declare a conflict of interest"
      description="If you know the applicant or have a stake in this project, you should not score it."
      actions={
        <>
          <Button
            data-autofocus
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Keep reviewing
          </Button>
          <Button
            variant="primary"
            aria-disabled={pending || undefined}
            onClick={() => {
              void confirm();
            }}
          >
            Declare a conflict
          </Button>
        </>
      }
    >
      <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink">
        <li>The assignment is removed from My reviews and you cannot open it again.</li>
        <li>Anything you have scored or written for it is deleted.</li>
        <li>Staff are told, and can give the application to another reviewer.</li>
      </ul>
      {failure.length > 0 && (
        <div role="alert" className="rounded-md border-2 border-danger bg-danger-soft p-3">
          <ul className="flex list-disc flex-col gap-1 pl-4 text-body text-danger">
            {failure.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
