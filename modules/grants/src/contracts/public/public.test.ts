// SPDX-License-Identifier: AGPL-3.0-or-later

import { checkRoute } from '@pixel-scientists/domain/api';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { openRoundSchema } from '../applications/answers.ts';
import { MAX_AMOUNT_MINOR } from '../programme/inputs.ts';
import { getPublicRound, listPublicRounds, publicRoundRoutes } from './routes.ts';
import {
  MAX_PUBLIC_ELIGIBILITY_ITEMS,
  MAX_PUBLIC_ROUNDS,
  publicEligibilityItemSchema,
  publicRoundListSchema,
  publicRoundSchema,
} from './schemas.ts';

const ID = '0b8f3a52-6c1d-4e7a-9f20-3d5c8e1b7a64';
const pounds = (amount: number) => ({ amountMinor: amount * 100, currency: 'GBP' });

const round = {
  id: ID,
  title: 'Spring 2027',
  programme: {
    title: 'Community spaces',
    summary: 'Grants for village halls and community centres.',
  },
  opensAt: '2027-02-01T09:00:00.000Z',
  closesAt: '2027-04-01T16:00:00.000Z',
  timeZone: 'Europe/London',
  awardMinimum: pounds(1_000),
  awardMaximum: pounds(25_000),
  eligibility: [
    {
      label: 'Is your organisation a registered charity?',
      explanation: 'This programme funds registered charities only.',
    },
  ],
};

const refused = (value: unknown) => !publicRoundSchema.safeParse(value).success;

describe('public round schemas', () => {
  it('accept an open round with public fields only', () => {
    expect(publicRoundSchema.parse(round)).toEqual(round);
    expect(publicRoundListSchema.parse({ rounds: [round] })).toEqual({ rounds: [round] });
    expect(publicRoundSchema.parse({ ...round, eligibility: [] }).eligibility).toEqual([]);
  });

  it('refuse each field that is not published', () => {
    const extra = {
      description: 'Our long programme description.',
      budget: pounds(500_000),
      status: 'open',
      stages: [{ id: ID, name: 'Assessment' }],
      stageNames: ['Assessment'],
      rubric: { criteria: [] },
      criteria: [],
      emailTemplates: {},
      form: { id: ID, definition: { sections: [] } },
      definition: { sections: [] },
      fields: [],
      applicationCount: 3,
      counts: { submitted: 3 },
      latePolicy: 'refuse',
      configHistory: [],
      versions: [],
      tenantId: ID,
      programmeId: ID,
      membershipId: ID,
      memberId: ID,
      userId: ID,
      partyId: ID,
      createdBy: ID,
      updatedBy: ID,
      decisions: [],
      outcome: 'accepted',
      reviewers: [],
      reviews: [],
      scores: [],
    };
    for (const [key, value] of Object.entries(extra)) {
      expect(refused({ ...round, [key]: value }), key).toBe(true);
    }
    for (const key of ['id', 'description', 'status', 'tenantId']) {
      expect(refused({ ...round, programme: { ...round.programme, [key]: ID } }), key).toBe(true);
    }
    expect(publicRoundListSchema.safeParse({ rounds: [round], tenantId: ID }).success).toBe(false);
    expect(publicRoundListSchema.safeParse({ rounds: [round], total: 1 }).success).toBe(false);
  });

  it('carry nothing from the form but each eligibility question’s label and explanation', () => {
    const item = round.eligibility[0];
    for (const [key, value] of Object.entries({
      fieldId: 'f_charity',
      type: 'yes_no',
      hint: 'A hint.',
      stopWhen: false,
      stopValues: ['no'],
      options: [],
      audiences: ['applicant'],
      classification: 'public',
    })) {
      expect(publicEligibilityItemSchema.safeParse({ ...item, [key]: value }).success, key).toBe(
        false,
      );
    }
  });

  it('cap every string at the length of its source field, and every list', () => {
    const long = (length: number) => 'a'.repeat(length);
    expect(refused({ ...round, title: long(121) })).toBe(true);
    expect(refused({ ...round, title: '' })).toBe(true);
    expect(refused({ ...round, programme: { ...round.programme, title: long(121) } })).toBe(true);
    expect(refused({ ...round, programme: { ...round.programme, summary: long(301) } })).toBe(true);
    expect(publicRoundSchema.safeParse({ ...round, title: long(120) }).success).toBe(true);
    expect(
      publicEligibilityItemSchema.safeParse({ label: long(501), explanation: 'x' }).success,
    ).toBe(false);
    expect(
      publicEligibilityItemSchema.safeParse({ label: 'x', explanation: long(1001) }).success,
    ).toBe(false);
    expect(
      publicEligibilityItemSchema.safeParse({ label: long(500), explanation: long(1000) }).success,
    ).toBe(true);
    const items = Array.from(
      { length: MAX_PUBLIC_ELIGIBILITY_ITEMS + 1 },
      () => round.eligibility[0],
    );
    expect(refused({ ...round, eligibility: items })).toBe(true);
    expect(refused({ ...round, eligibility: items.slice(1) })).toBe(false);
    const rounds = Array.from({ length: MAX_PUBLIC_ROUNDS + 1 }, () => round);
    expect(publicRoundListSchema.safeParse({ rounds }).success).toBe(false);
    expect(publicRoundListSchema.safeParse({ rounds: rounds.slice(1) }).success).toBe(true);
  });

  it('give times as UTC instants and an IANA time zone', () => {
    expect(refused({ ...round, opensAt: '2027-02-01T09:00' })).toBe(true);
    expect(refused({ ...round, closesAt: '1 April 2027' })).toBe(true);
    for (const timeZone of ['', '+01:00', 'GMT+1 (London)', `Europe/${'a'.repeat(64)}`]) {
      expect(refused({ ...round, timeZone }), timeZone).toBe(true);
    }
  });

  it('keep the programme set-up bound on awards, and the maximum at least the minimum', () => {
    expect(refused({ ...round, awardMinimum: { amountMinor: 0, currency: 'GBP' } })).toBe(true);
    expect(refused({ ...round, awardMinimum: { amountMinor: -100, currency: 'GBP' } })).toBe(true);
    expect(
      refused({ ...round, awardMaximum: { amountMinor: MAX_AMOUNT_MINOR + 1, currency: 'GBP' } }),
    ).toBe(true);
    expect(
      refused({ ...round, awardMaximum: { amountMinor: MAX_AMOUNT_MINOR, currency: 'GBP' } }),
    ).toBe(false);
    expect(refused({ ...round, awardMinimum: pounds(30_000) })).toBe(true);
    expect(refused({ ...round, awardMinimum: round.awardMaximum })).toBe(false);
    expect(refused({ ...round, awardMinimum: { ...pounds(1), currency: 'EUR' } })).toBe(true);
    expect(refused({ ...round, awardMinimum: { ...pounds(1), formatted: '£1' } })).toBe(true);
  });

  it('are the signed-in open round less its ids, plus the opening time and eligibility summary', () => {
    // A key added to either side fails here, so the public shape never widens silently.
    const keys = (schema: z.ZodObject) => Object.keys(schema.shape).sort();
    const signedIn = keys(openRoundSchema);
    const published = keys(publicRoundSchema);
    expect(published.filter((key) => !signedIn.includes(key))).toEqual(['eligibility', 'opensAt']);
    expect(signedIn.filter((key) => !published.includes(key))).toEqual([]);
    const signedInProgramme = keys(openRoundSchema.shape.programme);
    const publishedProgramme = keys(publicRoundSchema.shape.programme);
    expect(publishedProgramme.every((key) => signedInProgramme.includes(key))).toBe(true);
    expect(signedInProgramme.filter((key) => !publishedProgramme.includes(key))).toEqual(['id']);
  });
});

describe('public round routes', () => {
  const routes = Object.values(publicRoundRoutes);

  it('keep every route rule', () => {
    for (const route of routes) expect(checkRoute(route), route.path).toEqual([]);
  });

  it('are public GET routes with no session, permission, scope, query or body', () => {
    expect(routes).toEqual([listPublicRounds, getPublicRound]);
    for (const route of routes) {
      expect(route).toMatchObject({
        audience: 'public',
        module: 'grants',
        permission: null,
        scope: null,
        method: 'GET',
      });
      expect(route).not.toHaveProperty('query');
      expect(route).not.toHaveProperty('body');
      expect(route).not.toHaveProperty('idempotent');
    }
    expect(listPublicRounds.path).toBe('/public/tenants/:slug/rounds');
    expect(getPublicRound.path).toBe('/public/tenants/:slug/rounds/:roundId');
    expect(listPublicRounds.responses[200]).toBe(publicRoundListSchema);
    expect(getPublicRound.responses[200]).toBe(publicRoundSchema);
    expect(listPublicRounds.summary).toContain('up to 100');
  });

  it('take a valid slug and a uuid, and name no tenant or user', () => {
    const params = getPublicRound.params;
    expect(params.safeParse({ slug: 'northfield', roundId: ID }).success).toBe(true);
    for (const bad of [
      { slug: 'Northfield', roundId: ID },
      { slug: 'api', roundId: ID },
      { slug: 'northfield', roundId: '42' },
      { slug: 'northfield', roundId: ID, tenantId: ID },
      { slug: 'northfield', roundId: ID, userId: ID },
    ]) {
      expect(params.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(listPublicRounds.params.safeParse({ slug: 'northfield', tenantId: ID }).success).toBe(
      false,
    );
  });
});
