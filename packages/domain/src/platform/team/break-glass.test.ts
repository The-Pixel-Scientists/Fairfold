// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { checkRoute, type RouteContract } from '../../api/route.ts';
import { messageForIssue, messages } from '../messages.ts';
import * as breakGlass from './break-glass.ts';

const routes: RouteContract[] = Object.values(breakGlass.breakGlassRoutes);

const id = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';

/** Every property name in a schema, at any depth. */
function keysIn(schema: z.ZodType): string[] {
  const keys: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const { properties } = node as { properties?: Record<string, unknown> };
    if (properties) keys.push(...Object.keys(properties));
    for (const value of Object.values(node)) walk(value);
  };
  walk(z.toJSONSchema(schema, { io: 'output' }));
  return keys;
}

function textMessage(value: string): string | undefined {
  const issue = breakGlass.breakGlassReasonTextSchema.safeParse(value).error?.issues[0];
  return issue === undefined ? undefined : messageForIssue(issue);
}

describe('break-glass routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in breakGlassRoutes', () => {
    const exported = Object.values(breakGlass).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('open a grant with step-up, repeatably, and read your own without', () => {
    expect(breakGlass.openBreakGlass).toMatchObject({
      audience: 'console',
      module: 'platform',
      permission: 'platform.break_glass.use',
      scope: 'tenant',
      stepUp: true,
      idempotent: true,
    });
    expect(breakGlass.listOwnBreakGlass).toMatchObject({
      method: 'GET',
      permission: 'platform.break_glass.use',
    });
    expect('stepUp' in breakGlass.listOwnBreakGlass).toBe(false);
  });

  it('leave reviewing to the review permission', () => {
    for (const route of [
      breakGlass.listBreakGlassQueue,
      breakGlass.readBreakGlassReview,
      breakGlass.reviewBreakGlass,
    ]) {
      expect(route, route.path).toMatchObject({
        audience: 'console',
        module: 'platform',
        permission: 'platform.break_glass.review',
        scope: 'tenant',
      });
    }
  });

  it('never extend, change or end a grant: renewing is a new grant', () => {
    for (const route of routes) {
      expect(['GET', 'POST'], route.path).toContain(route.method);
      expect(route.path).not.toMatch(/extend|renew|end|close/);
    }
  });

  it('take no time from the caller, and answer the times the database set', () => {
    expect(Object.keys(breakGlass.breakGlassOpenSchema.shape)).toEqual([
      'recordType',
      'recordId',
      'reasonCode',
      'reasonText',
    ]);
    expect(Object.keys(breakGlass.breakGlassGrantSchema.shape)).toEqual([
      'id',
      'recordType',
      'recordId',
      'reasonCode',
      'grantedAt',
      'expiresAt',
    ]);
  });

  it('answer no record content, email or applicant identity', () => {
    for (const route of routes) {
      for (const schema of Object.values(route.responses)) {
        if (!(schema instanceof z.ZodType)) continue;
        for (const key of keysIn(schema)) {
          expect(key, route.path).not.toMatch(/email|content|answer|applicant|subject|title/i);
        }
      }
    }
  });
});

describe('break-glass reasons', () => {
  it('come from the closed list in ADR 0037', () => {
    expect(breakGlass.breakGlassReasons).toEqual([
      'risk_to_life',
      'safeguarding_concern',
      'legal_duty',
      'named_people_unavailable',
      'other',
    ]);
    expect(breakGlass.breakGlassOutcomes).toEqual(['justified', 'not_justified']);
  });

  it('need the requester own words, of 20 to 1,000 characters, without hidden characters', () => {
    const text = 'Concern raised out of hours.\nThe named lead is away.';
    expect(breakGlass.breakGlassReasonTextSchema.parse(`  ${text}  `)).toBe(text);
    expect(textMessage('x'.repeat(19))).toBe(messages.breakGlassReasonText);
    expect(textMessage(`${'x'.repeat(19)}     `)).toBe(messages.breakGlassReasonText);
    expect(textMessage('x'.repeat(1001))).toBe(messages.breakGlassReasonText);
    expect(textMessage(`${'x'.repeat(20)}‮`)).toBe(messages.textHidden);
    expect(textMessage(`${'x'.repeat(20)}\u0000`)).toBe(messages.textHidden);
  });

  it('refuse an unknown reason or outcome with words from the catalogue', () => {
    const open = breakGlass.breakGlassOpenSchema.safeParse({
      recordType: 'cases.case',
      recordId: id,
      reasonCode: 'curiosity',
      reasonText: 'x'.repeat(20),
    });
    const issues = open.error?.issues ?? [];
    expect(issues.find((issue) => issue.path[0] === 'reasonCode')?.message).toBe(
      messages.chooseReason,
    );
    const outcome = breakGlass.reviewBreakGlass.body.safeParse({ outcome: 'fine' });
    expect(outcome.error?.issues[0]?.message).toBe(messages.chooseOutcome);
  });

  it('open no record type while no module has a restrictable record', () => {
    const open = breakGlass.breakGlassOpenSchema.safeParse({
      recordType: 'cases.case',
      recordId: id,
      reasonCode: 'risk_to_life',
      reasonText: 'x'.repeat(20),
    });
    expect(open.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['recordType']);
  });
});
