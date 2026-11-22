// SPDX-License-Identifier: AGPL-3.0-or-later

import { rejectionReasons, withdrawalSchema } from '@pixel-scientists/domain/workflow';
import { useId, useRef, useState } from 'react';

import { useSubmit } from '../auth/useSubmit.ts';
import { Button } from '../Button.tsx';
import { Dialog } from '../dialog/index.ts';
import { ErrorSummary } from '../ErrorSummary.tsx';
import { RadioGroup } from '../RadioGroup.tsx';
import { rejectionReasonLabels, withdrawalReasonLabels } from './labels.ts';

type RejectionReason = (typeof rejectionReasons)[number];
type WithdrawalReason = (typeof withdrawalSchema.shape.reasonCode.options)[number];

export type Decision =
  | { kind: 'approve' }
  | { kind: 'reject'; reasonCode: RejectionReason }
  | { kind: 'withdraw'; reasonCode: WithdrawalReason };

export type DecisionKind = Decision['kind'];

export interface ApprovalDecisionDialogProps {
  kind: DecisionKind;
  /** The button's words: "Approve request", or the step's own. */
  submit: string;
  /**
   * Makes the decision. The key is the same on every try from this dialog, so
   * a retry is not a second decision. Throws the API's problem when it is
   * refused, and answers false when the person cancelled a confirmation, so
   * nothing was recorded.
   */
  onDecide: (decision: Decision, idempotencyKey: string) => Promise<boolean>;
  onClose: () => void;
  /** Steps aside, with what was chosen kept, while the person confirms it is them. */
  paused: boolean;
}

const copy = {
  approve: {
    title: 'Approve this request?',
    description: 'Your decision is recorded under your name and cannot be undone.',
  },
  reject: {
    title: 'Reject this request?',
    description:
      'Choose the reason. Your decision is recorded under your name and cannot be undone.',
  },
  withdraw: {
    title: 'Withdraw this request?',
    description: 'The approvers will no longer see it. Choose why you are withdrawing it.',
  },
} as const;

const withdrawalReasons = withdrawalSchema.shape.reasonCode.options;

/** Said by the form itself, in the shape useSubmit reads from the API's problems. */
function missingReason(): Error {
  const message = 'Choose a reason.';
  return Object.assign(new Error(message), {
    status: 422,
    detail: message,
    errors: [{ field: 'reasonCode', message }],
  });
}

function chosen(kind: DecisionKind, reason: string): Decision | null {
  if (kind === 'approve') return { kind };
  if (kind === 'reject') {
    const reasonCode = rejectionReasons.find((code) => code === reason);
    return reasonCode === undefined ? null : { kind, reasonCode };
  }
  const reasonCode = withdrawalReasons.find((code) => code === reason);
  return reasonCode === undefined ? null : { kind, reasonCode };
}

/**
 * Asks a member to confirm one decision: approve with no more to say, or
 * reject or withdraw with a reason chosen from the contract's list. Mount it
 * when it opens, so each decision gets its own idempotency key.
 */
export function ApprovalDecisionDialog({
  kind,
  submit,
  onDecide,
  onClose,
  paused,
}: ApprovalDecisionDialogProps) {
  const formId = useId();
  const key = useRef(crypto.randomUUID());
  const [reason, setReason] = useState('');
  const form = useSubmit(['reasonCode'], async () => {
    const decision = chosen(kind, reason);
    if (decision === null) throw missingReason();
    if (!(await onDecide(decision, key.current))) onClose();
  });

  return (
    <Dialog
      open={!paused}
      onOpenChange={(open) => {
        if (!open && !form.pending) onClose();
      }}
      title={copy[kind].title}
      description={copy[kind].description}
      actions={
        <>
          <Button onClick={onClose} data-autofocus={kind === 'approve' ? '' : undefined}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={kind === 'approve' ? 'primary' : 'danger'}
            aria-disabled={form.pending || undefined}
          >
            {submit}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={form.onSubmit} className="flex flex-col gap-4">
        {kind === 'approve' ? (
          form.errors[0] !== undefined && (
            <p key={form.attempt} role="alert" className="text-body font-medium text-danger">
              {form.errors[0].message}
            </p>
          )
        ) : (
          <ErrorSummary key={form.attempt} errors={form.errors} />
        )}
        {kind !== 'approve' && (
          <RadioGroup
            legend="Reason"
            id="reasonCode"
            name="reasonCode"
            value={reason}
            onValueChange={setReason}
            options={
              kind === 'reject'
                ? rejectionReasons.map((code) => ({
                    value: code,
                    label: rejectionReasonLabels[code],
                  }))
                : withdrawalReasons.map((code) => ({
                    value: code,
                    label: withdrawalReasonLabels[code],
                  }))
            }
            error={form.errorFor('reasonCode')}
          />
        )}
      </form>
    </Dialog>
  );
}
