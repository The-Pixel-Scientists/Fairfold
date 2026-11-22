// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The words for an approval request's states, outcomes and reasons.

import type {
  ApprovalRequestDetail,
  DecisionOutcome,
  RequestStatus,
} from '@pixel-scientists/domain/workflow';

export const rejectionReasonLabels = {
  incorrect_details: 'The details are incorrect',
  missing_evidence: 'Evidence is missing',
  outside_policy: 'It is outside our policy',
  duplicate: 'It duplicates another request',
  other: 'Another reason',
} as const;

export const withdrawalReasonLabels = {
  no_longer_needed: 'It is no longer needed',
  made_in_error: 'I made it in error',
  changes_needed: 'It needs changes first',
  requester_removed: 'The requester was removed',
} as const;

export const statusLabels: Record<RequestStatus, string> = {
  pending: 'Waiting for a decision',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const outcomeLabels: Record<DecisionOutcome, string> = {
  approve: 'Approved',
  reject: 'Rejected',
};

/** `payment_approval` as "Payment approval": a request names its step by id, and the definition's label is not sent. */
export function stepLabel({ stepId }: Pick<ApprovalRequestDetail, 'stepId'>): string {
  const words = stepId.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `2026-11-20T14:05:00.000Z` as "20 November 2026, 2:05pm" in UK time. */
export function formatTime(iso: string, timeZone = 'Europe/London'): string {
  const part = new Map(
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
    })
      .formatToParts(new Date(iso))
      .map(({ type, value }) => [type, value]),
  );
  const period = (part.get('dayPeriod') ?? '').toLowerCase();
  return `${part.get('day') ?? ''} ${part.get('month') ?? ''} ${part.get('year') ?? ''}, ${part.get('hour') ?? ''}:${part.get('minute') ?? ''}${period}`;
}
