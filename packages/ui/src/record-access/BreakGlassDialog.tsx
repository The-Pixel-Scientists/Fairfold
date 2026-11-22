// SPDX-License-Identifier: AGPL-3.0-or-later

import { ProblemError } from '@pixel-scientists/domain/api';
import {
  breakGlassReasons,
  breakGlassReasonTextSchema,
} from '@pixel-scientists/domain/platform/team';
import type { BreakGlassReason } from '@pixel-scientists/domain/platform/team';
import { useId, useState } from 'react';

import { formText } from '../auth/problems.ts';
import { useSubmit } from '../auth/useSubmit.ts';
import { Button } from '../Button.tsx';
import { Dialog } from '../dialog/Dialog.tsx';
import { ErrorSummary } from '../ErrorSummary.tsx';
import { FormField, Select, Textarea } from '../FormField.tsx';
import { formatUkTime } from './time.ts';

export const breakGlassReasonLabels: Record<BreakGlassReason, string> = {
  risk_to_life: 'Risk to life',
  safeguarding_concern: 'Safeguarding concern',
  legal_duty: 'Legal duty',
  named_people_unavailable: 'The people named on the record are not available',
  other: 'Another emergency',
};

export interface BreakGlassValues {
  reasonCode: BreakGlassReason;
  reasonText: string;
}

export interface BreakGlassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Opens the record for these reasons, after step-up, and gives the expiry
   * the server set. Give null when the person cancelled step-up, and throw
   * the API's problem (a `ProblemError`) when it was refused. The record is
   * the caller's; the dialog never sees its id.
   */
  onOpen: (values: BreakGlassValues) => Promise<{ expiresAt: string } | null>;
  /** Called from the confirmation, to show the record. */
  onContinue: () => void;
  /** Steps aside, with what was typed kept, while the person confirms it is them. */
  paused?: boolean;
}

const FIELDS = ['reasonCode', 'reasonText'] as const;

const invalid = (name: string, message: string) =>
  new ProblemError(400, message, { errors: [{ field: name, message }] });

const isReason = (value: string): value is BreakGlassReason =>
  (breakGlassReasons as readonly string[]).includes(value);

/**
 * Asks for a reason before opening one restricted record in an emergency.
 * It cannot be sent without a reason from the list and the person's own
 * words, sends no time, and shows only the expiry the server returned.
 */
export function BreakGlassDialog({
  open,
  onOpenChange,
  onOpen,
  onContinue,
  paused = false,
}: BreakGlassDialogProps) {
  const formId = useId();
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const form = useSubmit(FIELDS, async (data) => {
    const reasonCode = formText(data, 'reasonCode');
    if (!isReason(reasonCode)) throw invalid('reasonCode', 'Choose a reason from the list.');
    const text = breakGlassReasonTextSchema.safeParse(formText(data, 'reasonText'));
    if (!text.success) {
      throw invalid('reasonText', text.error.issues[0]?.message ?? 'Enter why you need access.');
    }
    const grant = await onOpen({ reasonCode, reasonText: text.data });
    if (grant !== null) setExpiresAt(grant.expiresAt);
  });

  if (expiresAt !== null) {
    return (
      <Dialog
        open={open && !paused}
        onOpenChange={onOpenChange}
        title="Emergency access is open"
        actions={
          <Button variant="primary" data-autofocus onClick={onContinue}>
            Continue to the record
          </Button>
        }
      >
        <p role="status" className="text-body text-ink">
          You can read this record until {formatUkTime(expiresAt)} UK time. After that, you need to
          open it again with a new reason.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open && !paused}
      onOpenChange={(next) => {
        if (!next && !form.pending) onOpenChange(false);
      }}
      title="Open this record in an emergency"
      description="You are opening a restricted record. Your name, the time and your reason are recorded and an administrator is alerted."
      actions={
        <>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="danger"
            aria-disabled={form.pending || undefined}
          >
            Open record in an emergency
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <ErrorSummary key={form.attempt} errors={form.errors} />
        <FormField label="Reason" id="reasonCode" error={form.errorFor('reasonCode')}>
          <Select data-autofocus name="reasonCode" defaultValue="">
            <option value="" disabled>
              Choose a reason
            </option>
            {breakGlassReasons.map((code) => (
              <option key={code} value={code}>
                {breakGlassReasonLabels[code]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Explain why you need access"
          id="reasonText"
          hint="20 to 1,000 characters. Do not name anyone."
          error={form.errorFor('reasonText')}
        >
          <Textarea name="reasonText" rows={5} maxLength={1000} />
        </FormField>
      </form>
    </Dialog>
  );
}
