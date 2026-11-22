// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { call, type Fetch } from '../api/call.ts';
import { ProblemError } from '../api/problem.ts';
import { checkRoute } from '../api/route.ts';
import * as approvals from './routes.ts';
import { approvalRequestSchema, rejectionSchema, withdrawalSchema } from './schemas.ts';

const routes = Object.values(approvals.approvalRoutes);
const REQUEST = '00000000-0000-4000-8000-0000000000aa';

describe('approval routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in approvalRoutes', () => {
    const exported = Object.values(approvals).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('are platform console routes over the tenant, narrowed by each subject module', () => {
    for (const route of routes) {
      expect(route).toMatchObject({ audience: 'console', module: 'platform', scope: 'tenant' });
    }
  });

  it('need step-up and the decide permission for every approve and reject, and nothing else', () => {
    const deciding = [approvals.approveRequest, approvals.rejectRequest];
    for (const route of routes) {
      const decides = deciding.some((decide) => decide === route);
      expect(route.permission, route.path).toBe(
        decides ? 'platform.approvals.decide' : 'platform.approvals.read',
      );
      expect('stepUp' in route && route.stepUp, route.path).toBe(decides);
      expect('idempotent' in route && route.idempotent, route.path).toBe(decides);
    }
  });

  it('take reason codes only, and never name a tenant, requester, approver or membership', () => {
    expect(Object.keys(rejectionSchema.shape)).toEqual(['reasonCode']);
    expect(Object.keys(withdrawalSchema.shape)).toEqual(['reasonCode']);
    expect('body' in approvals.approveRequest).toBe(false);
    for (const body of [
      { reasonCode: 'other', note: 'Jo Bloggs' },
      { reasonCode: 'other', approverId: REQUEST },
    ]) {
      expect(rejectionSchema.safeParse(body).success).toBe(false);
    }
    expect(withdrawalSchema.safeParse({ reasonCode: 'requester_removed' }).success).toBe(false);
    expect(withdrawalSchema.safeParse({ reasonCode: 'made_in_error' }).success).toBe(true);
  });

  it('answer no field of the subject', () => {
    expect(Object.keys(approvalRequestSchema.shape)).toEqual([
      'id',
      'definitionKey',
      'definitionVersionId',
      'stepId',
      'subjectId',
      'status',
      'requiredApprovals',
      'approvals',
      'requestedBy',
      'requestedAt',
      'dueAt',
      'closedAt',
      'closeReason',
    ]);
  });

  it('never echo a reason or id the caller sent', async () => {
    const fetch: Fetch = () => Promise.reject(new Error('A refused request is never sent.'));
    const problem = await call(
      approvals.rejectRequest,
      { params: { requestId: 'Zebedee-1234' }, body: { reasonCode: 'Quaile_secret' as never } },
      { fetch },
    ).catch((error: unknown) => error);
    expect(problem).toBeInstanceOf(ProblemError);
    const { detail, message, errors } = problem as ProblemError;
    expect(errors.map((error) => error.field).sort()).toEqual([
      'body.reasonCode',
      'params.requestId',
    ]);
    const shown = JSON.stringify([detail, message, errors]);
    for (const word of ['Zebedee', 'Quaile', 'secret']) expect(shown).not.toContain(word);
  });
});
