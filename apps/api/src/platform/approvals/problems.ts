// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The refusals of the approval service as problems (ADR 0004). Each says
// what went wrong and how to fix it, and none holds an id, a value or the
// database's own words. A refusal by the database maps by its SQLSTATE and
// constraint name, never by its message.

import type { DecisionRefusal } from '@pixel-scientists/domain/workflow';

import { ApiError } from '../../problems.ts';

export type Refusal =
  DecisionRefusal | 'step_up' | 'not_requester' | 'not_acting_member' | 'not_found';

const refusals: Record<Refusal, readonly [status: 403 | 404 | 409, detail: string]> = {
  request_closed: [409, 'This request is closed, so it can no longer be changed.'],
  step_complete: [409, 'This request has already been decided. Reload to see the outcome.'],
  requester_cannot_approve: [403, 'You made this request, so someone else must decide it.'],
  already_decided: [409, 'You have already decided this request.'],
  not_permitted: [403, 'You do not have permission to decide this request.'],
  step_up: [403, 'Confirm it is you again, then try again.'],
  not_requester: [403, 'Only the member who made this request can withdraw it.'],
  not_acting_member: [403, 'You do not have permission to do this.'],
  not_found: [404, 'We could not find what you asked for.'],
};

export function refusal(code: Refusal, cause?: unknown): ApiError {
  const [status, detail] = refusals[code];
  return new ApiError(status, detail, { reason: code, cause });
}

/** The database's own refusals: the same checks as the service's, made again. */
const byConstraint = new Map<string, Refusal>([
  ['approval_decision_requester', 'requester_cannot_approve'],
  ['approval_decision_once', 'already_decided'],
  ['approval_decision_pending', 'request_closed'],
  ['approval_decision_rejected', 'step_complete'],
  ['approval_decision_complete', 'step_complete'],
  ['approval_decision_step_up', 'step_up'],
  ['approval_request_final', 'request_closed'],
  ['approval_request_closing', 'not_acting_member'],
  ['approval_request_actor', 'not_acting_member'],
  ['approval_decision_actor', 'not_acting_member'],
]);

const FOREIGN_KEY_VIOLATION = '23503';

/** The problem for an error from the database, or undefined where it is not one of these refusals. */
export function databaseRefusal(error: unknown): ApiError | undefined {
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  if (code === FOREIGN_KEY_VIOLATION) return refusal('not_found', error);
  const named = typeof constraint === 'string' ? byConstraint.get(constraint) : undefined;
  return named === undefined ? undefined : refusal(named, error);
}
