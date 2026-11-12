// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Dialog, FormField, Select } from '@pixel-scientists/ui';
import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { adjustmentMessages, revokeReasonSchema } from '../../../contracts/index.ts';
import type { Adjustment } from '../../../contracts/index.ts';
import { problemLines } from '../../assessment/problems.ts';
import { removeAdjustment } from './loaders.ts';
import { givenWords, revokeOptions } from './words.ts';

export interface RevokeDialogProps {
  /** The adjustment to remove. The dialog is open while there is one. */
  adjustment: Adjustment | null;
  onClose: () => void;
  onRevoked: (adjustment: Adjustment) => void;
}

function RevokeForm({
  adjustment,
  onClose,
  onRevoked,
}: Omit<RevokeDialogProps, 'adjustment'> & { adjustment: Adjustment }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const code = revokeReasonSchema.safeParse(reason);
    setError(code.success ? undefined : adjustmentMessages.revokeReason);
    if (!code.success) return;
    setPending(true);
    setFailure([]);
    try {
      onRevoked(await removeAdjustment(adjustment.id, code.data));
    } catch (problem) {
      setFailure(problemLines(problem));
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
        <p role="alert" className="font-medium text-danger">
          {failure.join(' ')}
        </p>
      )}
      <FormField id="revokeReason" label="Why are you removing it?" error={error}>
        <Select
          value={reason}
          onChange={(event) => {
            setReason(event.currentTarget.value);
          }}
        >
          <option value="">Choose a reason</option>
          {revokeOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} data-autofocus>
          Keep adjustment
        </Button>
        <Button type="submit" variant="danger" aria-disabled={pending || undefined}>
          Remove adjustment
        </Button>
      </div>
      <p className="sr-only">{givenWords(adjustment)}</p>
    </form>
  );
}

/** Asks before removing an adjustment, and why. Removing cannot be undone: give a new one instead. */
export function RevokeDialog({ adjustment, onClose, onRevoked }: RevokeDialogProps) {
  return (
    <Dialog
      open={adjustment !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Remove this adjustment?"
      description={
        adjustment === null
          ? undefined
          : `${givenWords(adjustment)} for ${adjustment.organisation.name}. Removing it cannot be undone. To give it again, give a new adjustment.`
      }
    >
      {adjustment !== null && (
        <RevokeForm adjustment={adjustment} onClose={onClose} onRevoked={onRevoked} />
      )}
    </Dialog>
  );
}
