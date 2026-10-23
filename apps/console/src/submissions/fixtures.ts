// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the submission screens: submissions in the Autumn round as
// the API would answer, and the requests the screens make. Not part of the
// app.

import { projectedAnswersSchemas } from '@pixel-scientists/domain/api';
import type {
  ProgrammeList,
  Submission,
  SubmissionPage,
  SubmissionSummary,
} from '@pixel-scientists/grants/contracts';
import { screen } from '@testing-library/react';

import { organisationForm } from '../forms/fixtures.ts';
import {
  ids as programmeIds,
  manager,
  ok,
  programme,
  round,
  stages,
} from '../programme/fixtures.ts';
import type { Handlers } from '../programme/fixtures.ts';

export { manager, ok, organisationForm, programme, round, stages };
export type { Handlers };

export const ids = programmeIds;

/** A valid id for the nth thing a test makes up. */
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const NAMES = [
  'Brightwater Community Trust',
  'Harbourside Youth Project',
  'Millbrook Allotment Society',
  'Northfield Lunch Club',
  'Riverside Repair Cafe',
  'Eastgate Music Trust',
];

/** The nth submission: submitted a day apart, in the Intake stage, eligible, on time. */
export function summary(n: number, change: Partial<SubmissionSummary> = {}): SubmissionSummary {
  return {
    id: uuid(100 + n),
    programme: { id: ids.programme, title: programme.title },
    round: { id: ids.round, title: round.title },
    stage: { id: ids.intake, name: 'Intake' },
    organisation: {
      id: uuid(200 + n),
      name: NAMES[n % NAMES.length] ?? `Organisation ${String(n)}`,
    },
    status: 'submitted',
    submittedAt: `2026-10-${String(28 - (n % 20)).padStart(2, '0')}T12:00:00.000Z`,
    late: false,
    eligibility: 'eligible',
    ...change,
  };
}

export const page = (
  submissions: readonly SubmissionSummary[],
  more: Partial<Omit<SubmissionPage, 'submissions'>> = {},
): SubmissionPage => ({
  submissions: [...submissions],
  total: submissions.length,
  nextCursor: null,
  ...more,
});

/** The programme list the filters read. */
export const programmes: ProgrammeList = {
  programmes: [{ ...programme, rounds: [round] }],
};

const answers = {
  f_name: 'Riverside Lunch Club',
  f_charity: true,
  f_number: '1234567',
  f_story: 'We serve a hot lunch to forty older people every week.',
  f_spend: 'building',
};

/** One submission in full: answered, with one eligibility check and the history of a move to Review. */
export function detail(
  change: Omit<Partial<Submission>, 'answers'> & { answers?: Record<string, unknown> } = {},
): Submission {
  const { answers: given = answers, ...rest } = change;
  const base = summary(1, { stage: { id: ids.review, name: 'Review' } });
  return {
    ...base,
    form: { id: uuid(300), version: 3, definition: organisationForm },
    answers: projectedAnswersSchemas.staff.parse(given),
    organisation: {
      ...base.organisation,
      legalForm: 'Charitable incorporated organisation',
      identifiers: [
        { scheme: 'GB-CHC', identifier: '1234567', verified: true },
        { scheme: 'GB-COH', identifier: '01234567', verified: false },
      ],
    },
    contact: {
      personId: uuid(400),
      givenName: 'Sam',
      familyName: 'Patel',
      email: 'sam@riverside.example',
    },
    withdrawnAt: null,
    eligibilityChecks: [
      { outcome: 'eligible', fieldId: null, checkedAt: '2026-10-20T12:30:00.000Z' },
    ],
    history: [
      { event: 'submitted', at: '2026-10-20T12:00:00.000Z', by: 'Sam Patel' },
      {
        event: 'stage_changed',
        at: '2026-10-20T12:00:00.000Z',
        by: 'Sam Patel',
        from: null,
        to: { id: ids.intake, name: 'Intake' },
      },
      {
        event: 'stage_changed',
        at: '2026-10-22T09:00:00.000Z',
        by: 'Ada Reed',
        from: { id: ids.intake, name: 'Intake' },
        to: { id: ids.review, name: 'Review' },
      },
    ],
    ...rest,
  };
}

/** The address of a route, like the key stubApi() answers by. */
export const api = {
  programmes: 'GET /console/programmes',
  stages: `GET /console/rounds/${ids.round}/stages`,
  list: (search = '') => `GET /console/submissions${search}`,
  one: (id: string) => `GET /console/submissions/${id}`,
  files: (id: string) => `GET /console/submissions/${id}/files`,
  assignments: (id: string) => `GET /console/submissions/${id}/assignments`,
  move: (stageId: string) => `POST /console/stages/${stageId}/submissions`,
} as const;

/** What the list page reads for these submissions. */
export const listReads = (submissions: readonly SubmissionSummary[], search = ''): Handlers => ({
  ...manager(),
  [api.programmes]: ok(programmes),
  [api.stages]: ok({ stages }),
  [api.list(search)]: ok(page(submissions)),
});

export const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

/** The rows of the table, header row left out. */
export const rowsOfTable = () => screen.getAllByRole('row').slice(1);
