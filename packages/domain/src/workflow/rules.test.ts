// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import type { Permission } from '../platform/access.ts';
import { defineWorkflow, workflowDefinitionSchema, type ApprovalStep } from './definition.ts';
import {
  allowedTransitions,
  approvalsReceived,
  canTransition,
  checkApprovalDecision,
  checkApprovalForAction,
  stepOutcome,
  type DecisionState,
  type LinkedApproval,
  type Member,
  type RequestState,
} from './rules.ts';

const REQUESTER = '00000000-0000-4000-8000-00000000000a';
const ANNA = '00000000-0000-4000-8000-00000000000b';
const BEN = '00000000-0000-4000-8000-00000000000c';
const SUBJECT = '00000000-0000-4000-8000-0000000000d1';
const OTHER_SUBJECT = '00000000-0000-4000-8000-0000000000d2';

const definition = workflowDefinitionSchema.parse(
  defineWorkflow({
    key: 'grants.award_payment',
    version: 1,
    sensitiveRead: false,
    states: [
      { id: 'draft', label: 'Draft' },
      { id: 'awaiting_approval', label: 'Awaiting approval' },
      { id: 'approved', label: 'Approved', terminal: true },
    ],
    initial: 'draft',
    transitions: [
      {
        from: 'draft',
        to: 'awaiting_approval',
        label: 'Ask for approval',
        permission: 'grants.decisions.record',
      },
      {
        from: 'awaiting_approval',
        to: 'approved',
        label: 'Approve payment',
        permission: 'grants.decisions.record',
        approval: 'payment',
      },
      {
        from: 'awaiting_approval',
        to: 'draft',
        label: 'Return to draft',
        permission: 'grants.applications.triage',
      },
    ],
    approvalSteps: [
      {
        id: 'payment',
        label: 'Payment approval',
        approveLabel: 'Approve payment',
        rejectLabel: 'Reject payment',
        permission: 'grants.decisions.release',
        approvers: 2,
        movesMoney: true,
      },
    ],
  }),
);

const [step] = definition.approvalSteps as [ApprovalStep];
const [, approveTransition] = definition.transitions as [
  unknown,
  (typeof definition.transitions)[number],
];

function member(membershipId: string, ...permissions: Permission[]): Member {
  return { membershipId, permissions: new Set(permissions) };
}

const approver = (id: string) =>
  member(id, 'platform.approvals.decide', 'grants.decisions.release');
const recorder = member(REQUESTER, 'grants.decisions.record');

const pending: RequestState = { status: 'pending', requestedBy: REQUESTER, requiredApprovals: 2 };
const approve = (decidedBy: string): DecisionState => ({ decidedBy, outcome: 'approve' });
const reject = (decidedBy: string): DecisionState => ({ decidedBy, outcome: 'reject' });

describe('transitions', () => {
  it('lists the transitions a member may make from a state', () => {
    expect(allowedTransitions(definition, 'draft', recorder).map((t) => t.to)).toEqual([
      'awaiting_approval',
    ]);
    expect(allowedTransitions(definition, 'awaiting_approval', recorder)).toEqual([]);
    expect(
      allowedTransitions(definition, 'awaiting_approval', recorder, new Set(['payment'])),
    ).toEqual([approveTransition]);
  });

  it.each([
    ['an unknown transition', 'draft', 'approved', recorder, 'unknown_transition'],
    ['a transition from a terminal state', 'approved', 'draft', recorder, 'terminal_state'],
    ['a member without the permission', 'awaiting_approval', 'draft', recorder, 'not_permitted'],
    [
      'a transition before its approval completes',
      'awaiting_approval',
      'approved',
      recorder,
      'approval_pending',
    ],
  ] as const)('refuses %s', (_name, from, to, actor, reason) => {
    expect(canTransition(definition, from, to, actor)).toEqual({ allowed: false, reason });
  });

  it('allows a transition once its approval is accepted for the action', () => {
    const approved = new Set(['payment']);
    expect(canTransition(definition, 'awaiting_approval', 'approved', recorder, approved)).toEqual({
      allowed: true,
    });
  });
});

describe('separation of duties', () => {
  it.each<[string, RequestState, DecisionState[], Member, string | null]>([
    ['the requester approves', pending, [], approver(REQUESTER), 'requester_cannot_approve'],
    [
      'the same approver decides twice',
      pending,
      [approve(ANNA)],
      approver(ANNA),
      'already_decided',
    ],
    [
      'an approver without the step permission',
      pending,
      [],
      member(ANNA, 'platform.approvals.decide'),
      'not_permitted',
    ],
    [
      'an approver without the decide permission',
      pending,
      [],
      member(ANNA, 'grants.decisions.release'),
      'not_permitted',
    ],
    [
      'a decision on a closed request',
      { ...pending, status: 'withdrawn' },
      [],
      approver(ANNA),
      'request_closed',
    ],
    ['a decision after a rejection', pending, [reject(ANNA)], approver(BEN), 'step_complete'],
    [
      'a third approval on a two-approver step',
      pending,
      [approve(ANNA), approve(BEN)],
      approver('00000000-0000-4000-8000-00000000000e'),
      'step_complete',
    ],
    ['a first approval', pending, [], approver(ANNA), null],
    ['a second approval by another member', pending, [approve(ANNA)], approver(BEN), null],
  ])('%s', (_name, request, decisions, actor, reason) => {
    expect(checkApprovalDecision(step, request, decisions, actor)).toEqual(
      reason === null ? { allowed: true } : { allowed: false, reason },
    );
  });

  it('completes a two-approver step with two members', () => {
    expect(stepOutcome(pending, [approve(ANNA)])).toBe('pending');
    expect(stepOutcome(pending, [approve(ANNA), approve(BEN)])).toBe('approved');
    expect(approvalsReceived(pending, [approve(ANNA), approve(BEN)])).toBe(2);
  });

  it('counts one member once, however many times they decide', () => {
    expect(stepOutcome(pending, [approve(ANNA), approve(ANNA)])).toBe('pending');
    expect(approvalsReceived(pending, [approve(ANNA), approve(ANNA)])).toBe(1);
  });

  it('never counts the requester', () => {
    expect(stepOutcome(pending, [approve(REQUESTER), approve(ANNA)])).toBe('pending');
    expect(stepOutcome(pending, [reject(REQUESTER)])).toBe('pending');
  });

  it('rejects the step on one rejection', () => {
    expect(stepOutcome(pending, [approve(ANNA), reject(BEN)])).toBe('rejected');
  });
});

describe('using an approval for an action', () => {
  const linked: LinkedApproval = {
    status: 'approved',
    definitionKey: 'grants.award_payment',
    stepId: 'payment',
    subjectId: SUBJECT,
    used: false,
    pinHolds: true,
  };
  const check = (approval: Partial<LinkedApproval>, transition = approveTransition) =>
    checkApprovalForAction(definition, transition, SUBJECT, { ...linked, ...approval });

  it('accepts an approved, unused request for this subject, step and definition', () => {
    expect(check({})).toEqual({ allowed: true });
  });

  it.each<[string, Partial<LinkedApproval>, string]>([
    [
      'another definition with the same step id',
      { definitionKey: 'grants.other_payment' },
      'wrong_step',
    ],
    ['another step', { stepId: 'budget' }, 'wrong_step'],
    ['another subject', { subjectId: OTHER_SUBJECT }, 'wrong_subject'],
    ['a pending request', { status: 'pending' }, 'not_approved'],
    ['a rejected request', { status: 'rejected' }, 'not_approved'],
    ['a request used once already', { used: true }, 'already_used'],
    ['a subject changed since it was asked', { pinHolds: false }, 'subject_changed'],
  ])('refuses %s', (_name, approval, reason) => {
    expect(check(approval)).toEqual({ allowed: false, reason });
  });

  it('refuses an approval for a transition that needs none', () => {
    const [ask] = definition.transitions;
    expect(ask && check({}, ask)).toEqual({ allowed: false, reason: 'wrong_step' });
  });

  it('refuses a transition the definition does not hold, though it names the step', () => {
    const forged = { ...approveTransition, from: 'draft' };
    expect(check({}, forged)).toEqual({ allowed: false, reason: 'wrong_step' });
  });

  it('refuses every transition when a stored definition lets one step gate two', () => {
    const cancel = { ...approveTransition, to: 'draft', label: 'Cancel grant' };
    const loose = { ...definition, transitions: [...definition.transitions, cancel] };
    for (const transition of [approveTransition, cancel]) {
      expect(checkApprovalForAction(loose, transition, SUBJECT, linked)).toEqual({
        allowed: false,
        reason: 'wrong_step',
      });
    }
  });
});
