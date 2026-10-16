// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';

import { MAX_AMOUNT_MINOR } from '../programme/inputs.ts';
import { decisionListSchema } from './answers.ts';
import { decisionEmailErrorCodes } from './lists.ts';
import * as decisions from './routes.ts';

const routes = Object.values(decisions.decisionRoutes);
const ID = '5c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const ids = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `5c1d2e3f-4a5b-4c6d-8e7f-${index.toString(16).padStart(12, '0')}`,
  );
const minor = (amountMinor: number) => ({ amountMinor, currency: 'GBP' });

describe('decision routes', () => {
  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are all listed in decisionRoutes', () => {
    const exported = Object.values(decisions).filter(
      (value) => typeof value === 'object' && 'audience' in value,
    );
    expect(new Set(exported)).toEqual(new Set(routes));
  });

  it('record under one permission, and release only after signing in again', () => {
    expect(
      routes.map((route) => [
        `${route.method} ${route.path}`,
        route.permission,
        'stepUp' in route && route.stepUp,
      ]),
    ).toEqual([
      ['GET /console/rounds/:roundId/decisions', 'grants.decisions.record', false],
      ['PUT /console/submissions/:submissionId/decision', 'grants.decisions.record', false],
      ['POST /console/rounds/:roundId/decisions', 'grants.decisions.record', false],
      ['GET /console/submissions/:submissionId/decision/email', 'grants.decisions.record', false],
      ['POST /console/rounds/:roundId/decisions/release', 'grants.decisions.release', true],
      ['POST /console/rounds/:roundId/decision-emails/send', 'grants.decisions.release', true],
    ]);
    for (const route of routes) {
      expect(route).toMatchObject({ audience: 'console', module: 'grants', scope: 'tenant' });
    }
  });

  it('refuse a release route without step-up', () => {
    for (const route of [decisions.releaseDecisions, decisions.sendDecisionEmails]) {
      expect(checkRoute({ ...route, stepUp: false })).toContain(
        'Changes under grants.decisions.release need stepUp: true.',
      );
    }
  });
});

describe('recording a decision', () => {
  const { body } = decisions.recordDecision;

  it('takes an amount for an award, and none otherwise', () => {
    expect(body.parse({ outcome: 'accepted', amount: minor(2_500_000) })).toEqual({
      outcome: 'accepted',
      amount: minor(2_500_000),
    });
    expect(body.parse({ outcome: 'waitlisted' })).toEqual({ outcome: 'waitlisted' });
    expect(body.parse({ outcome: 'declined' })).toEqual({ outcome: 'declined' });
    for (const bad of [
      { outcome: 'accepted' },
      { outcome: 'declined', amount: minor(100) },
      { outcome: 'waitlisted', amount: minor(100) },
      { outcome: 'released' },
      { outcome: 'accepted', amount: minor(100), released: true },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('refuses an amount of zero, less, over the bound, in pounds or in another currency', () => {
    expect(body.safeParse({ outcome: 'accepted', amount: minor(MAX_AMOUNT_MINOR) }).success).toBe(
      true,
    );
    for (const amount of [
      minor(0),
      minor(-100),
      minor(MAX_AMOUNT_MINOR + 1),
      minor(25.5),
      { amountMinor: 100, currency: 'EUR' },
      { amountMinor: 100 },
      { ...minor(100), pounds: 1 },
    ]) {
      expect(body.safeParse({ outcome: 'accepted', amount }).success, JSON.stringify(amount)).toBe(
        false,
      );
    }
  });

  it('records up to 200 at once, each submission once', () => {
    const bulk = decisions.recordDecisions.body;
    const decision = { outcome: 'declined' };
    const items = (list: string[]) => list.map((submissionId) => ({ submissionId, decision }));
    expect(bulk.safeParse({ decisions: items(ids(200)) }).success).toBe(true);
    for (const bad of [
      { decisions: [] },
      { decisions: items(ids(201)) },
      { decisions: items([ID, ID]) },
      { decisions: [{ submissionId: ID, decision: { outcome: 'accepted', amount: minor(0) } }] },
      { decisions: [{ submissionId: ID, outcome: 'declined' }] },
    ]) {
      expect(bulk.safeParse(bad).success).toBe(false);
    }
  });
});

describe('releasing decisions', () => {
  const { body } = decisions.releaseDecisions;

  it('releases all only when asked to, or up to 200 chosen', () => {
    expect(body.parse({ release: 'all' })).toEqual({ release: 'all' });
    expect(body.safeParse({ release: 'chosen', submissionIds: ids(200) }).success).toBe(true);
    for (const bad of [
      {},
      { submissionIds: [ID] },
      { release: 'chosen' },
      { release: 'chosen', submissionIds: [] },
      { release: 'chosen', submissionIds: ids(201) },
      { release: 'chosen', submissionIds: [ID, ID] },
      { release: 'all', submissionIds: [ID] },
    ]) {
      expect(body.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('decision emails', () => {
  it("record the SMTP sender's failure codes, and a missing address", () => {
    expect(decisionEmailErrorCodes).toEqual([
      'invalid_message',
      'connection_failed',
      'tls_failed',
      'timeout',
      'auth_failed',
      'rejected',
      'recipient_refused',
      'failed',
      'no_address',
    ]);
  });
});

describe('the decision list', () => {
  it('drops any field it does not declare', () => {
    const list = {
      round: {
        id: ID,
        title: 'Spring 2027',
        budget: minor(25_000_000),
        awardMinimum: minor(100_000),
        awardMaximum: minor(2_500_000),
      },
      submissions: [
        {
          submissionId: ID,
          organisation: { id: ID, name: 'Northfield Community Trust' },
          stage: { id: ID, name: 'Decision' },
          meanScore: 4.25,
          reviews: 2,
          decision: {
            outcome: 'accepted',
            amount: minor(2_500_000),
            recordedAt: '2027-03-26T10:00:00Z',
            releasedAt: null,
          },
          email: null,
        },
      ],
      awarded: minor(2_500_000),
      unsentEmails: 0,
    };
    const extra = structuredClone(list);
    Object.assign(extra.submissions[0] ?? {}, { contact: { email: 'sam@example.org' } });
    expect(decisionListSchema.parse(extra)).toEqual(list);
  });
});
