// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Whether a transition is allowed and whether a member may decide an
// approval (ADR 0038), as pure functions the server, the database tests and
// the screens all ask. The member is the session's membership with the
// permissions the server resolved from it at the time of the check (rule
// 6); nothing here takes a tenant or trusts a request body. Members of
// another tenant are refused by the server (404) and the database (composite
// foreign keys and row-level security), never here. Each answer is a code,
// never words carrying a value.
//
// Nothing here changes a state: every transition is one a named member asks
// for (rule 9), and an approval never stands in for a grants decision or its
// release (rule 8).

import type { Id } from '../id.ts';
import type { Permission } from '../platform/access.ts';
import type { ApprovalStep, WorkflowDefinition, WorkflowTransition } from './definition.ts';
import type { DecisionOutcome, RequestStatus } from './schemas.ts';

export interface Member {
  readonly membershipId: Id;
  readonly permissions: ReadonlySet<Permission>;
}

/** A request as the server read it, with its pinned count. */
export interface RequestState {
  readonly status: RequestStatus;
  readonly requestedBy: Id;
  readonly requiredApprovals: number;
}

export interface DecisionState {
  readonly decidedBy: Id;
  readonly outcome: DecisionOutcome;
}

export type Answer<R extends string> =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: R };

const yes = { allowed: true } as const;
const no = <R extends string>(reason: R) => ({ allowed: false, reason }) as const;

export type TransitionRefusal =
  'terminal_state' | 'unknown_transition' | 'not_permitted' | 'approval_pending';

/**
 * Whether the member may move from one state to another. `approved` holds
 * the steps with a request that checkApprovalForAction() accepted for this
 * subject and transition.
 */
export function canTransition(
  definition: WorkflowDefinition,
  from: string,
  to: string,
  member: Member,
  approved: ReadonlySet<string> = new Set(),
): Answer<TransitionRefusal> {
  if (definition.states.find(({ id }) => id === from)?.terminal === true)
    return no('terminal_state');
  const transition = definition.transitions.find((t) => t.from === from && t.to === to);
  if (transition === undefined) return no('unknown_transition');
  if (!member.permissions.has(transition.permission)) return no('not_permitted');
  if (transition.approval !== undefined && !approved.has(transition.approval)) {
    return no('approval_pending');
  }
  return yes;
}

/** The transitions from a state the member may make now. */
export function allowedTransitions(
  definition: WorkflowDefinition,
  state: string,
  member: Member,
  approved: ReadonlySet<string> = new Set(),
): WorkflowTransition[] {
  return definition.transitions.filter(
    (t) => t.from === state && canTransition(definition, state, t.to, member, approved).allowed,
  );
}

/** Distinct members other than the requester who approved. A member counts once. */
export function approvalsReceived(
  request: RequestState,
  decisions: readonly DecisionState[],
): number {
  const approvers = decisions
    .filter((d) => d.outcome === 'approve' && d.decidedBy !== request.requestedBy)
    .map((d) => d.decidedBy);
  return new Set(approvers).size;
}

export type StepOutcome = 'pending' | 'approved' | 'rejected';

/** One rejection rejects the step; it is approved once it has its required approvals. */
export function stepOutcome(
  request: RequestState,
  decisions: readonly DecisionState[],
): StepOutcome {
  const others = decisions.filter((d) => d.decidedBy !== request.requestedBy);
  if (others.some((d) => d.outcome === 'reject')) return 'rejected';
  return approvalsReceived(request, decisions) >= request.requiredApprovals
    ? 'approved'
    : 'pending';
}

export type DecisionRefusal =
  | 'request_closed'
  | 'step_complete'
  | 'requester_cannot_approve'
  | 'already_decided'
  | 'not_permitted';

/**
 * Separation of duties: whether a member may approve or reject a request
 * for this step. The server also checks the member reaches the subject
 * through its module's scope rule without break-glass (ADR 0037), and the
 * database checks the decider, the requester and the count again.
 */
export function checkApprovalDecision(
  step: ApprovalStep,
  request: RequestState,
  decisions: readonly DecisionState[],
  approver: Member,
): Answer<DecisionRefusal> {
  if (request.status !== 'pending') return no('request_closed');
  if (stepOutcome(request, decisions) !== 'pending') return no('step_complete');
  if (approver.membershipId === request.requestedBy) return no('requester_cannot_approve');
  if (decisions.some((d) => d.decidedBy === approver.membershipId)) return no('already_decided');
  const { permissions } = approver;
  if (!permissions.has('platform.approvals.decide') || !permissions.has(step.permission)) {
    return no('not_permitted');
  }
  return yes;
}

/** A request as a module's action reads it through its link table. */
export interface LinkedApproval {
  readonly status: RequestStatus;
  readonly definitionKey: string;
  readonly stepId: string;
  /** The subject the link row names. */
  readonly subjectId: Id;
  /** Whether the module's action log already records an action under it. */
  readonly used: boolean;
  /** Whether the module's pin still holds: the subject is as it was when asked. */
  readonly pinHolds: boolean;
}

export type ActionRefusal =
  'wrong_step' | 'wrong_subject' | 'not_approved' | 'already_used' | 'subject_changed';

/**
 * Whether an approved request authorises this transition on this subject:
 * one action, once, on the subject as it was when asked. The module's log
 * and its foreign key to the link row hold the same line in the database.
 * A request names only its step, so the step must gate this one transition
 * of the definition and no other.
 */
export function checkApprovalForAction(
  definition: WorkflowDefinition,
  transition: WorkflowTransition,
  subjectId: Id,
  approval: LinkedApproval,
): Answer<ActionRefusal> {
  const gated = definition.transitions.filter(({ approval: id }) => id === approval.stepId);
  if (
    transition.approval === undefined ||
    approval.definitionKey !== definition.key ||
    approval.stepId !== transition.approval ||
    gated.length !== 1 ||
    gated[0]?.from !== transition.from ||
    gated[0].to !== transition.to
  ) {
    return no('wrong_step');
  }
  if (approval.subjectId !== subjectId) return no('wrong_subject');
  if (approval.status !== 'approved') return no('not_approved');
  if (approval.used) return no('already_used');
  if (!approval.pinHolds) return no('subject_changed');
  return yes;
}
