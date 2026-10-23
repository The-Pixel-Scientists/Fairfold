// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Test helpers for the team screens: a funder's team as the API describes it,
// and the usual answers. Not part of the app.

import { northfield } from '../../testing/api.ts';
import { SESSION, administrator, ok } from '../settings/testing.ts';

export const TEAM = 'GET /console/team';
export const SETTINGS = 'GET /console/settings';
export const STEP_UP = 'POST /auth/step-up';

/** The signed-in administrator's own membership is the first member's. */
export const ada = {
  id: northfield.id,
  name: 'Ada Morgan',
  email: 'ada@example.org',
  roles: ['tenant_admin'],
  status: 'active',
} as const;

export const marcus = {
  id: '7c2d9e4f-3a5b-4c8d-8e1f-2b3c4d5e6f70',
  name: 'Marcus Bell',
  email: 'marcus@example.org',
  roles: ['programme_manager', 'reviewer'],
  status: 'active',
} as const;

export const priya = {
  id: '3f1e5a7b-9c2d-4e6f-8a1b-0c9d8e7f6a5b',
  name: null,
  email: 'priya@example.org',
  roles: ['reviewer'],
  status: 'suspended',
} as const;

export const invitation = {
  id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
  email: 'fatima@example.org',
  roles: ['reviewer'],
  expiresAt: '2026-11-04T17:00:00.000Z',
} as const;

export const team = (
  members: readonly unknown[] = [ada, marcus, priya],
  invitations: readonly unknown[] = [invitation],
) => ok({ members, invitations });

/** The answers every team page needs, from an administrator's session. */
export const base = (members?: readonly unknown[], invitations?: readonly unknown[]) => ({
  [SESSION]: ok(administrator()),
  [TEAM]: team(members, invitations),
  [SETTINGS]: ok({
    name: 'Northfield Foundation',
    timeZone: 'Europe/London',
    fiscalYearStartMonth: 4,
  }),
});
