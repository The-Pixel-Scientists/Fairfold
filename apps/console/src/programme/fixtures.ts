// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the programme set-up screens: Community Spaces Fund and
// its round as the API would answer, and the requests the screens make. Not
// part of the app.

import { defaultEmailTemplates } from '@pixel-scientists/grants/contracts';
import type { ConfigHistory, Programme, Round, Stage } from '@pixel-scientists/grants/contracts';
import { screen } from '@testing-library/react';

import { consoleSession } from '../testing/api.ts';
import type { Reply, stubApi } from '../testing/api.ts';

export const ids = {
  programme: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  round: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  intake: 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f',
  review: 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80',
  decision: 'e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091',
  need: 'f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f8091a2',
  approach: 'a7b8c9d0-e1f2-4a3b-8c5d-6e7f8091a2b3',
  value: 'b8c9d0e1-f2a3-4b4c-9d6e-7f8091a2b3c4',
  author: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
} as const;

export const pounds = (amount: number) => ({ amountMinor: amount * 100, currency: 'GBP' }) as const;

export const programme: Programme = {
  id: ids.programme,
  title: 'Community Spaces Fund',
  summary: 'Grants for places where neighbours meet.',
  description:
    'Funds repairs, equipment and running costs.\n\nOpen to charities and community groups.',
  status: 'draft',
};

export const round: Round = {
  id: ids.round,
  programmeId: ids.programme,
  title: 'Autumn 2026',
  opensAt: '2026-10-12T09:00',
  closesAt: '2026-11-02T17:00',
  timeZone: 'Europe/London',
  budget: pounds(150_000),
  awardMinimum: pounds(5_000),
  awardMaximum: pounds(25_000),
  latePolicy: 'refuse',
};

export const stages: Stage[] = [
  { id: ids.intake, name: 'Intake', position: 1, criteria: [] },
  {
    id: ids.review,
    name: 'Review',
    position: 2,
    criteria: [
      {
        id: ids.need,
        label: 'Need',
        guidance: 'Is there evidence of local need?',
        weight: 5,
        scaleMin: 1,
        scaleMax: 5,
      },
      {
        id: ids.approach,
        label: 'Approach',
        guidance: '',
        weight: 3,
        scaleMin: 1,
        scaleMax: 5,
      },
      {
        id: ids.value,
        label: 'Value for money',
        guidance: '',
        weight: 2,
        scaleMin: 1,
        scaleMax: 5,
      },
    ],
  },
  { id: ids.decision, name: 'Decision', position: 3, criteria: [] },
];

export const templates = {
  accepted: { ...defaultEmailTemplates.accepted, version: 1 },
  waitlisted: { ...defaultEmailTemplates.waitlisted, version: 1 },
  declined: { ...defaultEmailTemplates.declined, version: 2 },
};

export const history: ConfigHistory = {
  versions: [
    {
      version: 2,
      createdAt: '2026-10-13T10:30:00.000Z',
      author: { membershipId: ids.author, name: 'Ada Reed' },
      changes: [{ path: 'closesAt', from: '2026-11-02T17:00', to: '2026-11-09T17:00' }],
    },
    {
      version: 1,
      createdAt: '2026-10-12T08:00:00.000Z',
      author: { membershipId: ids.author, name: null },
      changes: [{ path: 'title', from: null, to: 'Autumn 2026' }],
    },
  ],
};

/** The answers a test gives stubApi(), keyed like `GET /console/programmes`. */
export type Handlers = Parameters<typeof stubApi>[0];

export const SESSION = 'GET /auth/session';
export const manager = () => ({ [SESSION]: ok(consoleSession()) });

export const ok = (body: unknown): Reply => ({ status: 200, body });

/** The address of a route, like the key stubApi() answers by. */
export const api = {
  programmes: 'GET /console/programmes',
  programme: `GET /console/programmes/${ids.programme}`,
  updateProgramme: `PUT /console/programmes/${ids.programme}`,
  createProgramme: 'POST /console/programmes',
  rounds: `GET /console/programmes/${ids.programme}/rounds`,
  createRound: `POST /console/programmes/${ids.programme}/rounds`,
  round: `GET /console/rounds/${ids.round}`,
  updateRound: `PUT /console/rounds/${ids.round}`,
  stages: `GET /console/rounds/${ids.round}/stages`,
  setStages: `PUT /console/rounds/${ids.round}/stages`,
  setRubric: `PUT /console/stages/${ids.review}/rubric`,
  emails: `GET /console/programmes/${ids.programme}/email-templates`,
  setEmails: `PUT /console/programmes/${ids.programme}/email-templates`,
  programmeHistory: `GET /console/programmes/${ids.programme}/history`,
  roundHistory: `GET /console/rounds/${ids.round}/history`,
} as const;

/** What a round's page reads, and the reads the programme page makes. */
export const reads = {
  [api.programme]: ok(programme),
  [api.rounds]: ok({ rounds: [round] }),
  [api.emails]: ok(templates),
  [api.programmeHistory]: ok(history),
  [api.round]: ok(round),
  [api.stages]: ok({ stages }),
  [api.roundHistory]: ok(history),
};

export const heading = (name: string) => screen.findByRole('heading', { level: 1, name });

/** The item at an index, which a test has already seen is there. */
export function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`There is no item ${String(index)}.`);
  return item;
}
