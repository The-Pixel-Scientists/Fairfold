// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { databaseRefusal, refusal } from './problems.ts';

describe('the refusals', () => {
  it('say what went wrong and how to fix it, and show no value', () => {
    expect(refusal('requester_cannot_approve').detail).toBe(
      'You made this request, so someone else must decide it.',
    );
    expect(refusal('step_up')).toMatchObject({
      status: 403,
      detail: 'Confirm it is you again, then try again.',
    });
    expect(refusal('not_found')).toMatchObject({
      status: 404,
      detail: 'We could not find what you asked for.',
    });
  });
});

describe('the database refusals', () => {
  it('map by constraint name, never by message', () => {
    const named = (code: string, constraint: string, message = 'unrelated words') =>
      databaseRefusal(Object.assign(new Error(message), { code, constraint }));

    expect(named('23514', 'approval_decision_requester')?.reason).toBe('requester_cannot_approve');
    expect(named('23505', 'approval_decision_once')?.reason).toBe('already_decided');
    expect(named('23514', 'approval_decision_pending')?.reason).toBe('request_closed');
    expect(named('23514', 'approval_decision_rejected')?.reason).toBe('step_complete');
    expect(named('23514', 'approval_decision_complete')?.reason).toBe('step_complete');
    expect(named('42501', 'approval_decision_step_up')?.reason).toBe('step_up');
    expect(named('42501', 'approval_decision_actor')?.status).toBe(403);
    expect(named('23514', 'approval_request_final')?.status).toBe(409);
    expect(
      named(
        '23514',
        'approval_decision_requester',
        'The member who asked cannot decide the request.',
      )?.detail,
    ).not.toContain('asked');
  });

  it('answers a foreign key violation as a missing request, and leaves other errors alone', () => {
    expect(databaseRefusal({ code: '23503', constraint: 'any' })?.status).toBe(404);
    expect(databaseRefusal({ code: '23514', constraint: 'constructor' })).toBeUndefined();
    expect(databaseRefusal({ code: '40001' })).toBeUndefined();
    expect(databaseRefusal(new Error('boom'))).toBeUndefined();
  });
});
