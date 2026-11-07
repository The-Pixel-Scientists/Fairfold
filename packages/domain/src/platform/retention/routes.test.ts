// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { checkRoute } from '../../api/route.ts';
import { messageForIssue, messages } from '../messages.ts';
import { changeRetentionPolicy, listRetentionPolicies, retentionRoutes } from './routes.ts';
import {
  retentionChangeSchema,
  retentionDaysProblem,
  retentionPolicyQuerySchema,
  retentionPolicySchema,
} from './schemas.ts';

const policy = {
  policyId: 'audit',
  labelKey: 'audit',
  days: 730,
  minimumDays: 365,
  defaultDays: 365,
  changed: true,
};

describe('retention routes', () => {
  it('keep every route rule, under the retention permission over the tenant', () => {
    for (const route of Object.values(retentionRoutes)) {
      expect(checkRoute(route), route.path).toEqual([]);
      expect(route).toMatchObject({
        audience: 'console',
        module: 'platform',
        permission: 'platform.retention.manage',
        scope: 'tenant',
      });
    }
  });

  it('need step-up to change a period, and not to read them', () => {
    expect(changeRetentionPolicy).toMatchObject({ method: 'PUT', stepUp: true });
    expect('stepUp' in listRetentionPolicies).toBe(false);
  });
});

describe('retention schemas', () => {
  it('take a policy id by its pattern, and days only in the body', () => {
    expect(retentionPolicyQuerySchema.parse({ policyId: 'audit' })).toEqual({ policyId: 'audit' });
    for (const query of [
      { policyId: 'Audit' },
      { policyId: '9lives' },
      { policyId: 'a'.repeat(64) },
    ]) {
      expect(retentionPolicyQuerySchema.safeParse(query).success, query.policyId).toBe(false);
    }
    expect(retentionChangeSchema.parse({ days: 1 })).toEqual({ days: 1 });
    expect(retentionChangeSchema.parse({ days: 36_500 })).toEqual({ days: 36_500 });
  });

  it('refuse unknown keys and periods that are not whole days from 1 to 36,500', () => {
    for (const body of [
      { days: 0 },
      { days: 36_501 },
      { days: 30.5 },
      { days: '365' },
      {},
      { days: 365, policyId: 'audit' },
      { days: 365, tenantId: '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64' },
    ]) {
      expect(retentionChangeSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(retentionPolicySchema.safeParse({ ...policy, note: 'x' }).success).toBe(false);
    expect(retentionPolicySchema.parse(policy)).toEqual(policy);
  });

  it('word a refused period from the catalogue, never repeating it', () => {
    const result = retentionChangeSchema.safeParse({ days: 98_765 });
    expect(result.success).toBe(false);
    const [issue] = result.error?.issues ?? [];
    expect(messageForIssue(issue ?? {})).toBe(messages.retentionDays);
    expect(messages.retentionDays).not.toContain('98765');
  });

  it('refuse a period under the minimum on days, naming the minimum and not the value', () => {
    expect(retentionDaysProblem(365)).toEqual({
      field: 'body.days',
      message: 'This is shorter than the platform allows for this data. Enter 365 days or more.',
    });
    expect(retentionDaysProblem(1).message).toContain('Enter 1 day or more.');
    for (const message of [messages.retentionDays, retentionDaysProblem(365).message]) {
      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).not.toMatch(/sorry|apolog/i);
    }
  });
});
