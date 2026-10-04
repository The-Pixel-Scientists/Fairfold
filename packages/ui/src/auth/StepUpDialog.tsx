// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from '../Button.tsx';
import { Dialog } from '../dialog/index.ts';
import { ErrorSummary } from '../ErrorSummary.tsx';
import { FormField, Input } from '../FormField.tsx';
import { formText } from './problems.ts';
import { useSubmit } from './useSubmit.ts';

export interface StepUpCredentials {
  password: string;
  code: string;
}

export interface StepUpDialogProps {
  open: boolean;
  /** Called with false when the person cancels, and after a successful confirmation. */
  onOpenChange: (open: boolean) => void;
  /**
   * Confirms the person with the step-up route, then carries on with what
   * needed it. Throw the API's problem (a `ProblemError`) to show what went
   * wrong in the dialog.
   */
  onConfirm: (credentials: StepUpCredentials) => Promise<void>;
}

const FIELDS = ['password', 'code'] as const;

/** The dialog opens over any page, so its field ids must not match the page's own. */
const fieldId = (field: string) => `step-up-${field}`;

function StepUpForm({ onOpenChange, onConfirm }: Omit<StepUpDialogProps, 'open'>) {
  const form = useSubmit(FIELDS, async (data) => {
    await onConfirm({ password: formText(data, 'password'), code: formText(data, 'code') });
    onOpenChange(false);
  });

  return (
    <form noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
      <ErrorSummary
        key={form.attempt}
        errors={form.errors.map((error) => ({
          ...error,
          fieldId: fieldId(error.fieldId),
        }))}
      />
      <FormField label="Password" error={form.errorFor('password')} id={fieldId('password')}>
        <Input name="password" type="password" autoComplete="current-password" />
      </FormField>
      <FormField
        label="Code from your authenticator app"
        hint="The 6 digits shown in the app."
        error={form.errorFor('code')}
        id={fieldId('code')}
      >
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} />
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" aria-disabled={form.pending || undefined}>
          Confirm it is you
        </Button>
      </div>
    </form>
  );
}

/**
 * Asks for the password and a code from the authenticator app, for an action
 * that needs a recent sign-in (ADR 0010). A screen opens it when the API says
 * the action needs re-authentication, and carries on in `onConfirm`.
 */
export function StepUpDialog({ open, onOpenChange, onConfirm }: StepUpDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Confirm it is you"
      description="This action needs a recent check. Enter your password and the current code from your authenticator app."
    >
      <StepUpForm onOpenChange={onOpenChange} onConfirm={onConfirm} />
    </Dialog>
  );
}
