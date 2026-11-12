// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stands in for the API for the retention, subject access and erasure specs:
// an administrator with those permissions, one synthetic person, and requests
// whose status the spec sets. Changes are refused until the administrator has
// confirmed it is them, as the real routes do. Answers are plain JSON in the
// shape of the contracts; the console checks each one against its contract.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { northfield, problem, stubSignedIn } from './auth-api.ts';
import type { Handler, Reply, SentRequest } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';

export const PARTY = '3f1e5a7b-9c2d-4e6f-8a1b-0c9d8e7f6a5b';
export const REQUEST = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
export const FILE = '5d1c2b9a-3e4f-4a6b-8c7d-9e0f1a2b3c4d';
export const SUFFIX = '– Fairfold Grants console';

const STEP_UP_NEEDED = 'Confirm it is you again, then try again.';

const permissions = [
  'platform.settings.manage',
  'platform.retention.manage',
  'platform.subject_access.request',
  'platform.erasure.request',
  'crm.records.read',
];

const requested = { id: REQUEST, requestedAt: '2026-11-10T09:00:00.000Z' };
export const queued = { ...requested, status: 'queued' };
export const ready = {
  ...requested,
  status: 'ready',
  fileId: FILE,
  expiresAt: '2026-11-17T09:30:00.000Z',
};
export const expired = { ...requested, status: 'expired' };
export const failed = { ...requested, status: 'failed', failureCode: 'job_failed' };
export const erased = {
  ...requested,
  status: 'done',
  counts: { 'party.person': 1, 'grants.application_answer': 12 },
};

export const audit = {
  policyId: 'audit',
  labelKey: 'audit',
  days: 2555,
  minimumDays: 365,
  defaultDays: 2555,
  changed: false,
};

const ok = (body: unknown): Reply => ({ status: 200, body });
const accepted: Reply = { status: 202, body: { requestId: REQUEST } };

export interface GovernanceStub {
  sent: SentRequest[];
  /** Whether the administrator has confirmed it is them. Changes are refused until they have. */
  recent: boolean;
}

/**
 * A signed-in administrator. `more` replaces answers, keyed like
 * `GET /console/retention-policies`.
 */
export async function stubGovernance(
  page: Page,
  more: Record<string, Handler> = {},
): Promise<GovernanceStub> {
  const stub: GovernanceStub = { sent: [], recent: false };
  const guarded =
    (reply: Reply): Handler =>
    () =>
      stub.recent ? reply : problem(403, STEP_UP_NEEDED);
  stub.sent = await stubSignedIn(
    page,
    { permissions },
    {
      'POST /auth/step-up': () => {
        stub.recent = true;
        return ok({
          user: { id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', email: 'ada@example.org' },
          expiresAt: '2099-01-01T00:00:00.000Z',
          app: 'console',
          mfa: 'complete',
          recentAuthUntil: '2099-01-01T00:00:00.000Z',
          activeMembership: { ...northfield, roles: ['tenant_admin'] },
          memberships: [{ ...northfield, roles: ['tenant_admin'] }],
          permissions,
          modules: ['grants'],
        });
      },
      'GET /console/retention-policies': ok({ policies: [audit] }),
      'PUT /console/retention-policies': guarded(ok({ ...audit, days: 3650, changed: true })),
      'POST /console/crm/search': ok({
        results: [
          {
            id: PARTY,
            kind: 'person',
            label: 'Amara Okafor',
            status: 'active',
            verification: 'none',
          },
        ],
        nextCursor: null,
      }),
      [`GET /console/crm/people/${PARTY}`]: ok({
        state: 'current',
        status: 'active',
        person: {
          id: PARTY,
          givenName: 'Amara',
          familyName: 'Okafor',
          email: 'amara@example.org',
          phone: null,
          organisations: [],
          consents: [],
        },
        lists: [],
        externalReferences: [],
        timeline: { interactions: 0, latestAt: null },
      }),
      'POST /console/subject-access-requests': guarded(accepted),
      'POST /console/erasure-requests': guarded(accepted),
      [`GET /console/subject-access-requests/${REQUEST}`]: ok(ready),
      [`GET /console/erasure-requests/${REQUEST}`]: ok(erased),
      ...more,
    },
  );
  return stub;
}

/** Answers the step-up dialog with the password and a code. */
export async function confirmItsYou(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Password').fill('correct horse battery');
  await dialog.getByLabel('Code from your authenticator app').fill('123456');
  await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
  await expect(dialog).toBeHidden();
}

export const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

export interface State {
  name: string;
  /** Sets the API's answers for this state. */
  stub?: (page: Page) => Promise<unknown>;
  /** Opens the screen, gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

/** Checks every state at desktop width, 320 px wide and 200% zoom, and desktop width in the dark scheme. */
export function checkStates(states: readonly State[]): void {
  for (const variant of variants) {
    test.describe(`at ${variant.name}`, () => {
      test.use({
        viewport: variant.viewport,
        deviceScaleFactor: variant.deviceScaleFactor,
        colorScheme: variant.scheme,
      });

      for (const state of states) {
        test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
          await (state.stub ?? ((target) => stubGovernance(target)))(page);
          await state.open(page);
          await expect(page.locator('h1')).toHaveCount(1);

          await expectNoViolations(page);
          await expectNoHorizontalScroll(page);
        });
      }
    });
  }
}
