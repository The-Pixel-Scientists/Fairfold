// SPDX-License-Identifier: AGPL-3.0-or-later

import { approvalRequestDetailSchema } from '@pixel-scientists/domain/workflow';
import type { ApprovalRequestDetail } from '@pixel-scientists/domain/workflow';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApprovalPanel } from './ApprovalPanel.tsx';
import type { ApprovalPanelProps } from './ApprovalPanel.tsx';

afterEach(cleanup);

const ME = '0b8f7c1e-7a3d-4c55-9a52-2f6f1a9d4e10';
const REQUESTER = '7c2d9e4f-3a5b-4c8d-8e1f-2b3c4d5e6f70';
const OTHER = '3f1e5a7b-9c2d-4e6f-8a1b-0c9d8e7f6a5b';

function request(change: Partial<ApprovalRequestDetail> = {}): ApprovalRequestDetail {
  return approvalRequestDetailSchema.parse({
    id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
    definitionKey: 'grants.payment_run',
    definitionVersionId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    stepId: 'payment_approval',
    subjectId: '2b3c4d5e-6f70-4a81-92a3-b4c5d6e7f809',
    status: 'pending',
    requiredApprovals: 1,
    approvals: 0,
    requestedBy: REQUESTER,
    requestedAt: '2026-11-20T14:05:00.000Z',
    dueAt: null,
    closedAt: null,
    closeReason: null,
    decisions: [],
    canDecide: true,
    canWithdraw: false,
    ...change,
  });
}

function show(
  change: Partial<ApprovalRequestDetail> = {},
  props: Partial<ApprovalPanelProps> = {},
) {
  const onDecide = vi.fn<ApprovalPanelProps['onDecide']>().mockResolvedValue(true);
  render(<ApprovalPanel request={request(change)} memberId={ME} onDecide={onDecide} {...props} />);
  return onDecide;
}

describe('ApprovalPanel', () => {
  it('shows the state in words, the step, the count and the history in UK time', () => {
    show({
      requiredApprovals: 2,
      approvals: 1,
      decisions: [
        {
          decidedBy: OTHER,
          outcome: 'approve',
          reasonCode: null,
          decidedAt: '2026-11-20T14:30:00.000Z',
        },
      ],
    });
    expect(screen.getByText('Waiting for a decision')).toBeTruthy();
    expect(screen.getByText('Payment approval')).toBeTruthy();
    expect(screen.getByText('1 of 2 approvals')).toBeTruthy();
    expect(screen.getByText(/Approved by a colleague/)).toBeTruthy();
    expect(screen.getByText(/20 November 2026, 2:30pm/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeTruthy();
  });

  it('uses the step own labels for the buttons', () => {
    show(
      {},
      {
        step: { label: 'Payment', approveLabel: 'Approve payment', rejectLabel: 'Reject payment' },
      },
    );
    expect(screen.getByRole('button', { name: 'Approve payment' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject payment' })).toBeTruthy();
  });

  it.each([
    [
      'the requester',
      { canDecide: false, requestedBy: ME },
      'You made this request, so someone else must approve it.',
    ],
    [
      'a member who has decided',
      {
        canDecide: false,
        requiredApprovals: 2,
        approvals: 1,
        decisions: [
          {
            decidedBy: ME,
            outcome: 'approve',
            reasonCode: null,
            decidedAt: '2026-11-20T14:30:00.000Z',
          },
        ],
      },
      'You have already decided this request.',
    ],
    [
      'a member of a step that has what it needs',
      {
        canDecide: false,
        approvals: 1,
        decisions: [
          {
            decidedBy: OTHER,
            outcome: 'approve',
            reasonCode: null,
            decidedAt: '2026-11-20T14:30:00.000Z',
          },
        ],
      },
      'This step has all the decisions it needs.',
    ],
    [
      'a member without permission',
      { canDecide: false },
      'You cannot decide this request. Ask an administrator to give you access.',
    ],
    [
      'a closed request',
      { canDecide: false, status: 'approved' },
      'This request is closed, so it needs no more decisions.',
    ],
  ] as const)('shows no buttons to %s and says why', (_name, change, sentence) => {
    show(change as Partial<ApprovalRequestDetail>);
    expect(screen.getByText(sentence)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve|reject/i })).toBeNull();
  });

  it('offers withdraw only when the server allows it, and says who stops seeing it', async () => {
    show({ canDecide: false, canWithdraw: true, requestedBy: ME });
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/approvers will no longer see it/)).toBeTruthy();
  });

  it('asks for a reason on reject and sends nothing without one', async () => {
    const onDecide = show();
    await userEvent.click(screen.getByRole('button', { name: 'Reject request' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject request' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(onDecide).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('radio', { name: 'Evidence is missing' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject request' }));
    expect(onDecide).toHaveBeenCalledWith(
      { kind: 'reject', reasonCode: 'missing_evidence' },
      expect.any(String),
    );
    expect(await screen.findByText('Request rejected')).toBeTruthy();
  });

  it('reuses the idempotency key when a refused decision is tried again, and sends one at a time', async () => {
    const onDecide = show();
    onDecide.mockRejectedValueOnce(
      Object.assign(new Error('x'), { status: 0, detail: 'No connection.', errors: [] }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Approve request' }));
    const dialog = await screen.findByRole('dialog');
    const button = within(dialog).getByRole('button', { name: 'Approve request' });
    await userEvent.click(button);
    expect(await within(dialog).findByText('No connection.')).toBeTruthy();
    await userEvent.dblClick(button);

    const keys = onDecide.mock.calls.map(([, key]) => key);
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('closes the dialog and records nothing when the person cancels the confirmation', async () => {
    const onDecide = show();
    onDecide.mockResolvedValue(false);
    await userEvent.click(screen.getByRole('button', { name: 'Approve request' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve request' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.queryByText('Request approved')).toBeNull();
  });

  it('moves focus to the status line after a decision, not to the page', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Approve request' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve request' }));
    expect(await screen.findByText('Request approved')).toBeTruthy();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('status'));
    });
    expect(document.activeElement).not.toBe(document.body);
  });
});
