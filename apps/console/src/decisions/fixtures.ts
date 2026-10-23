// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the decision screens: a round's submissions with their
// scores and decisions as the API would answer, and the requests the screens
// make. Not part of the app.

import type {
  Decision,
  DecisionList,
  DecisionRow,
  Outcome,
} from '@pixel-scientists/grants/contracts';
import { screen } from '@testing-library/react';

import { ids, manager, ok, pounds, programme, round } from '../programme/fixtures.ts';

export { ids, manager, ok, pounds, programme, round };

/** A valid id for the nth thing a test makes up. */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const api = {
  list: `GET /console/rounds/${ids.round}/decisions`,
  record: (submissionId: string) => `PUT /console/submissions/${submissionId}/decision`,
  recordMany: `POST /console/rounds/${ids.round}/decisions`,
  email: (submissionId: string) => `GET /console/submissions/${submissionId}/decision/email`,
  release: `POST /console/rounds/${ids.round}/decisions/release`,
  send: `POST /console/rounds/${ids.round}/decision-emails/send`,
  round: `GET /console/rounds/${ids.round}`,
  programme: `GET /console/programmes/${ids.programme}`,
  stepUp: 'POST /auth/step-up',
} as const;

export const decision = (
  outcome: Outcome,
  change: Partial<Decision> = {},
  amount = outcome === 'accepted' ? 12_500 : null,
): Decision => ({
  outcome,
  amount: amount === null ? null : pounds(amount),
  recordedAt: '2026-11-20T10:00:00.000Z',
  releasedAt: null,
  ...change,
});

const NAMES = [
  'Harbourside Youth Project',
  'Millbrook Allotment Society',
  'Northfield Lunch Club',
  'Riverside Repair Cafe',
  'Eastgate Music Trust',
];

/** The nth submission: scored 4.2 less a tenth for each place down, with no decision. */
export const row = (n: number, change: Partial<DecisionRow> = {}): DecisionRow => ({
  submissionId: uuid(100 + n),
  organisation: { id: uuid(200 + n), name: NAMES[n - 1] ?? `Organisation ${String(n)}` },
  stage: { id: ids.decision, name: 'Decision' },
  meanScore: Math.round((4.3 - n / 10) * 100) / 100,
  reviews: 2,
  decision: null,
  email: null,
  ...change,
});

export const list = (
  submissions: readonly DecisionRow[],
  change: Partial<DecisionList> = {},
): DecisionList => ({
  round: {
    id: ids.round,
    title: round.title,
    budget: round.budget,
    awardMinimum: round.awardMinimum,
    awardMaximum: round.awardMaximum,
  },
  submissions: [...submissions],
  awarded: pounds(
    submissions.reduce((sum, item) => sum + (item.decision?.amount?.amountMinor ?? 0) / 100, 0),
  ),
  unsentEmails: 0,
  ...change,
});

/** Five submissions: one awarded, one waitlisted, one declined, two with no decision. */
export const rows = [
  row(1, { decision: decision('accepted') }),
  row(2, { decision: decision('waitlisted') }),
  row(3, { decision: decision('declined') }),
  row(4),
  row(5, { meanScore: null, reviews: 0 }),
];

/** What the decisions page reads. */
export const pageReads = (found: DecisionList = list(rows)) => ({
  ...manager(),
  [api.round]: ok(round),
  [api.programme]: ok(programme),
  [api.list]: ok(found),
});

export const heading = (name: string) => screen.findByRole('heading', { level: 1, name });
