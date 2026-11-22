// SPDX-License-Identifier: AGPL-3.0-or-later

import { stepOutcome } from '@pixel-scientists/domain/workflow';
import type { ApprovalRequestDetail, ApprovalStep } from '@pixel-scientists/domain/workflow';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '../Button.tsx';
import { Panel } from '../layout/Panel.tsx';
import { SummaryList } from '../layout/SummaryList.tsx';
import { Tag } from '../layout/Tag.tsx';
import type { TagTone } from '../layout/Tag.tsx';
import { ApprovalDecisionDialog } from './ApprovalDecisionDialog.tsx';
import type { Decision, DecisionKind } from './ApprovalDecisionDialog.tsx';
import {
  formatTime,
  outcomeLabels,
  rejectionReasonLabels,
  statusLabels,
  stepLabel,
} from './labels.ts';

export interface ApprovalPanelProps {
  request: ApprovalRequestDetail;
  /** The signed-in member's membership id, to say "you" in the history. */
  memberId: string;
  /** The definition's words for the step, when the module has them. */
  step?: Pick<ApprovalStep, 'label' | 'approveLabel' | 'rejectLabel'>;
  /** The time zone times show in. UK time without one. */
  zone?: string | null;
  /**
   * Makes one decision, as ApprovalDecisionDialog describes. The panel shows
   * the new state from `request`, so the caller replaces it on success and
   * reads it again after a refusal.
   */
  onDecide: (decision: Decision, idempotencyKey: string) => Promise<boolean>;
  /** A confirmation is open over the decision dialog. */
  paused?: boolean;
  /** The subject's own summary, from its module. */
  children?: ReactNode;
}

const tones: Record<ApprovalRequestDetail['status'], TagTone> = {
  pending: 'info',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

const announcements: Record<DecisionKind, string> = {
  approve: 'Request approved',
  reject: 'Request rejected',
  withdraw: 'Request withdrawn',
};

/** Why a member who cannot decide a request cannot, in a sentence. The server's `canDecide` is the control. */
function whyNot(request: ApprovalRequestDetail, memberId: string): string {
  if (request.status !== 'pending') return 'This request is closed, so it needs no more decisions.';
  if (request.requestedBy === memberId) {
    return 'You made this request, so someone else must approve it.';
  }
  if (request.decisions.some(({ decidedBy }) => decidedBy === memberId)) {
    return 'You have already decided this request.';
  }
  if (stepOutcome(request, request.decisions) !== 'pending') {
    return 'This step has all the decisions it needs.';
  }
  return 'You cannot decide this request. Ask an administrator to give you access.';
}

const who = (id: string, memberId: string) => (id === memberId ? 'you' : 'a colleague');

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * One approval request: its state in words, the step and how many approvals
 * it has, who may act, the decisions so far, and the buttons the server says
 * this member may use. It decides nothing itself; every decision is one
 * button press confirmed in a dialog.
 */
export function ApprovalPanel({
  request,
  memberId,
  step,
  zone,
  onDecide,
  paused = false,
  children,
}: ApprovalPanelProps) {
  const [open, setOpen] = useState<DecisionKind | null>(null);
  const [said, setSaid] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const label = step?.label ?? stepLabel(request);
  const submit = {
    approve: step?.approveLabel ?? 'Approve request',
    reject: step?.rejectLabel ?? 'Reject request',
    withdraw: 'Withdraw request',
  };

  async function decide(decision: Decision, key: string): Promise<boolean> {
    const done = await onDecide(decision, key);
    if (done) {
      setSaid(announcements[decision.kind]);
      setOpen(null);
      // The buttons are gone with the new state, so focus stays in the panel, on the status line.
      setTimeout(() => statusLine.current?.focus(), 50);
    } else {
      // Radix returns focus to what it last held, which is gone; wait for it, then go to the opener.
      setTimeout(() => opener.current?.focus(), 50);
    }
    return done;
  }

  const pending = request.status === 'pending';
  const time = zone ?? undefined;
  const items = [
    {
      term: 'State',
      value: <Tag tone={tones[request.status]}>{statusLabels[request.status]}</Tag>,
    },
    { term: 'Step', value: label },
    {
      term: 'Approvals',
      value: `${String(request.approvals)} of ${String(request.requiredApprovals)} ${request.requiredApprovals === 1 ? 'approval' : 'approvals'}`,
    },
    { term: 'Requested', value: formatTime(request.requestedAt, time) },
    ...(pending && request.dueAt !== null
      ? [{ term: 'Due', value: formatTime(request.dueAt, time) }]
      : []),
  ];

  return (
    <Panel title="Approval">
      <p
        ref={statusLine}
        role="status"
        tabIndex={-1}
        className="min-h-6 text-body font-medium text-success"
      >
        {said}
      </p>
      {children}
      <SummaryList items={items} />
      <div className="flex flex-col items-start gap-3">
        {pending && request.canDecide ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen('approve');
              }}
            >
              {submit.approve}
            </Button>
            <Button
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen('reject');
              }}
            >
              {submit.reject}
            </Button>
          </div>
        ) : (
          <p className="max-w-prose text-body text-muted">{whyNot(request, memberId)}</p>
        )}
        {request.canWithdraw && (
          <Button
            onClick={(event) => {
              opener.current = event.currentTarget;
              setOpen('withdraw');
            }}
          >
            {submit.withdraw}
          </Button>
        )}
      </div>
      <section aria-labelledby="approval-history" className="flex flex-col gap-2">
        <h3 id="approval-history" className="text-md font-semibold text-ink">
          Decisions so far
        </h3>
        {request.decisions.length === 0 ? (
          <p className="text-body text-muted">No one has decided this request yet.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-divider">
            {request.decisions.map((decision) => (
              <li key={`${decision.decidedBy}-${decision.decidedAt}`} className="py-2 text-body">
                {upper(
                  `${outcomeLabels[decision.outcome].toLowerCase()} by ${who(decision.decidedBy, memberId)}`,
                )}
                {decision.reasonCode !== null && `: ${rejectionReasonLabels[decision.reasonCode]}`}
                <span className="text-muted"> on {formatTime(decision.decidedAt, time)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      {open !== null && (
        <ApprovalDecisionDialog
          kind={open}
          submit={submit[open]}
          onDecide={decide}
          paused={paused}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </Panel>
  );
}
