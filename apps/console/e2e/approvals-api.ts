// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the approvals specs: one pending request, and a
// decision route that asks for step-up until the member has confirmed it is
// them, as the real routes do. Every answer is parsed through the contract in
// packages/domain/src/workflow, so a stub that drifts from it fails the test.

import {
  approvalPageSchema,
  approvalRequestDetailSchema,
  approvalRequestSchema,
} from '@pixel-scientists/domain/workflow';
import type { ApprovalRequestDetail } from '@pixel-scientists/domain/workflow';
import type { Page } from '@playwright/test';

import { northfield, problem, stubSignedIn } from './auth-api.ts';
import type { Handler, Reply, SentRequest } from './auth-api.ts';

export const REQUEST_ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
export const COLLEAGUE = '7c2d9e4f-3a5b-4c8d-8e1f-2b3c4d5e6f70';

const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const summary = {
  id: REQUEST_ID,
  definitionKey: 'grants.payment_run',
  definitionVersionId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  stepId: 'payment_approval',
  subjectId: '2b3c4d5e-6f70-4a81-92a3-b4c5d6e7f809',
  status: 'pending',
  requiredApprovals: 1,
  approvals: 0,
  requestedBy: COLLEAGUE,
  requestedAt: '2026-11-20T14:05:00.000Z',
  dueAt: null,
  closedAt: null,
  closeReason: null,
};

export const detail = (change: Partial<ApprovalRequestDetail> = {}): ApprovalRequestDetail =>
  approvalRequestDetailSchema.parse({
    ...summary,
    decisions: [],
    canDecide: true,
    canWithdraw: false,
    ...change,
  });

export interface ApprovalsStub {
  request: ApprovalRequestDetail;
  /** Whether the member has confirmed it is them. Decisions are refused until they have. */
  recent: boolean;
  sent: SentRequest[];
}

export interface ApprovalsOptions {
  /** The requests the inbox lists. One pending request by default. */
  listed?: readonly unknown[];
  request?: Partial<ApprovalRequestDetail>;
  recent?: boolean;
  /** Replaces the decision routes' answers, keyed like `POST /console/approvals/:id/approve`. */
  more?: Record<string, Handler>;
}

const ok = (body: unknown): Reply => ({ status: 200, body });

/** A signed-in programme manager, who holds both approvals permissions. */
export async function stubApprovals(
  page: Page,
  options: ApprovalsOptions = {},
): Promise<ApprovalsStub> {
  const stub: ApprovalsStub = {
    request: detail(options.request),
    recent: options.recent ?? false,
    sent: [],
  };
  const base = `/console/approvals/${REQUEST_ID}`;
  const permissions = ['platform.approvals.read', 'platform.approvals.decide'];

  const decide =
    (outcome: 'approve' | 'reject') =>
    (body: unknown): Reply => {
      if (!stub.recent) return problem(403, STEP_UP_NEEDED);
      const reasonCode = (body as { reasonCode?: string } | undefined)?.reasonCode ?? null;
      stub.request = detail({
        status: outcome === 'approve' ? 'approved' : 'rejected',
        approvals: outcome === 'approve' ? stub.request.requiredApprovals : 0,
        canDecide: false,
        decisions: [
          {
            decidedBy: northfield.id,
            outcome,
            reasonCode: reasonCode as 'other' | null,
            decidedAt: '2026-11-20T15:00:00.000Z',
          },
        ],
      });
      return { status: 201, body: approvalRequestDetailSchema.parse(stub.request) };
    };

  stub.sent = await stubSignedIn(
    page,
    { permissions },
    {
      'GET /console/settings': ok({
        name: 'Northfield Foundation',
        timeZone: 'Europe/London',
        fiscalYearStartMonth: 4,
      }),
      'GET /console/approvals': () =>
        ok(
          approvalPageSchema.parse({
            requests: (options.listed ?? [summary]).map((each) =>
              approvalRequestSchema.parse(each),
            ),
            nextCursor: null,
          }),
        ),
      [`GET ${base}`]: () => ok(approvalRequestDetailSchema.parse(stub.request)),
      [`POST ${base}/approve`]: decide('approve'),
      [`POST ${base}/reject`]: decide('reject'),
      'POST /auth/step-up': () => {
        stub.recent = true;
        return ok({
          user: { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', email: 'ada@example.org' },
          expiresAt: '2099-01-01T00:00:00.000Z',
          app: 'console',
          mfa: 'complete',
          recentAuthUntil: '2099-01-01T00:00:00.000Z',
          activeMembership: { ...northfield, roles: ['programme_manager'] },
          memberships: [{ ...northfield, roles: ['programme_manager'] }],
          permissions,
          modules: ['grants'],
        });
      },
      ...options.more,
    },
  );
  return stub;
}
