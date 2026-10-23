// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the team page, the invitation page and each of their states
// and dialogs, at desktop width, at 320 px wide and at 200% zoom (ADR 0006),
// and at desktop width in the dark scheme, with the API's answers stubbed
// (team-api.ts). In console-production they run under the production content
// security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { consoleSession, problem, signedOut, stubApi } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { stubTeam } from './team-api.ts';
import { memberRow, membersTable, sendInvitation, status } from './team-steps.ts';

/** Each page loads its code when first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';
const busy = problem(503, 'The service is busy. Try again in a minute.');

interface State {
  name: string;
  /** Sets the API's answers for this state. Every state of the team page starts with an administrator's team. */
  stub?: (page: Page) => Promise<unknown>;
  /** Opens the screen, gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const openTeam = async (page: Page) => {
  await page.goto('/northfield/team');
  await expect(membersTable(page)).toBeVisible();
};

const row = (page: Page, name: string, action: string) =>
  memberRow(page, name).getByRole('button', { name: action });

const teamStates: State[] = [
  { name: 'the team', open: openTeam },
  {
    name: 'the team with one row focused',
    open: async (page) => {
      await openTeam(page);
      await memberRow(page, /Marcus Bell/).focus();
      await expect(memberRow(page, /Marcus Bell/)).toBeFocused();
    },
  },
  {
    name: 'the team with no invitation waiting',
    stub: (page) => stubTeam(page, { invitations: [] }),
    open: async (page) => {
      await openTeam(page);
      await expect(
        page.getByRole('heading', { level: 3, name: 'No invitations waiting' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the team after a change',
    stub: (page) => stubTeam(page, { recent: true }),
    open: async (page) => {
      await openTeam(page);
      await row(page, 'Marcus Bell', 'Suspend').click();
      await page.getByRole('button', { name: 'Suspend Marcus Bell' }).click();
      await expect(status(page)).toHaveText('Marcus Bell is suspended and signed out.');
    },
  },
  {
    name: 'the invitation dialog',
    open: async (page) => {
      await openTeam(page);
      await page.getByRole('button', { name: 'Invite someone' }).first().click();
      await expect(page.getByRole('dialog', { name: 'Invite someone' })).toBeVisible();
    },
  },
  {
    name: 'the invitation dialog with problems to fix',
    open: async (page) => {
      await openTeam(page);
      await sendInvitation(page, 'nobody', 'reviewer');
      await page.getByRole('checkbox', { name: /^Reviewer/ }).uncheck();
      await page.getByRole('button', { name: 'Send invitation' }).click();
      await expect(
        page.getByRole('dialog').getByText('Choose at least one role.').first(),
      ).toBeVisible();
    },
  },
  {
    name: 'the roles dialog',
    open: async (page) => {
      await openTeam(page);
      await row(page, 'Marcus Bell', 'Change roles').click();
      await expect(
        page.getByRole('dialog', { name: 'Change roles for Marcus Bell' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the suspend confirmation',
    open: async (page) => {
      await openTeam(page);
      await row(page, 'Marcus Bell', 'Suspend').click();
      await expect(page.getByRole('dialog', { name: 'Suspend Marcus Bell?' })).toBeVisible();
    },
  },
  {
    name: 'the reinstate confirmation',
    open: async (page) => {
      await openTeam(page);
      await row(page, 'priya@example.org', 'Reinstate').click();
      await expect(
        page.getByRole('dialog', { name: 'Reinstate priya@example.org?' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the remove confirmation',
    open: async (page) => {
      await openTeam(page);
      await row(page, 'Marcus Bell', 'Remove').click();
      await expect(
        page.getByRole('dialog', { name: 'Remove Marcus Bell from the team?' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the revoke confirmation',
    open: async (page) => {
      await openTeam(page);
      await page.getByRole('button', { name: /^Revoke invitation/ }).click();
      await expect(
        page.getByRole('dialog', { name: 'Revoke the invitation to fatima@example.org?' }),
      ).toBeVisible();
    },
  },
  {
    name: 'a confirmation that the API refused',
    stub: (page) => stubTeam(page, { recent: true }, {}),
    open: async (page) => {
      await openTeam(page);
      await page.route(
        (url) => url.pathname.startsWith('/api/console/team/members'),
        (route) =>
          route.fulfill({
            status: busy.status,
            contentType: 'application/json',
            body: JSON.stringify(busy.body),
          }),
      );
      await row(page, 'Marcus Bell', 'Remove').click();
      await page.getByRole('button', { name: 'Remove Marcus Bell' }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
        'The service is busy',
      );
    },
  },
  {
    name: 'the step-up dialog',
    open: async (page) => {
      await openTeam(page);
      await row(page, 'Marcus Bell', 'Suspend').click();
      await page.getByRole('button', { name: 'Suspend Marcus Bell' }).click();
      await expect(page.getByRole('dialog', { name: 'Confirm it is you' })).toBeVisible();
    },
  },
  {
    name: 'the step-up dialog after a refused code',
    stub: (page) =>
      stubTeam(page, {}, { 'POST /auth/step-up': problem(401, 'The code was already used.') }),
    open: async (page) => {
      await openTeam(page);
      await row(page, 'Marcus Bell', 'Suspend').click();
      await page.getByRole('button', { name: 'Suspend Marcus Bell' }).click();
      const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
      await dialog.getByLabel('Password').fill('correct horse battery');
      await dialog.getByLabel('Code from your authenticator app').fill('123456');
      await dialog.getByRole('button', { name: 'Confirm it is you' }).click();
      await expect(dialog.getByText(/Your password or code is not right/).first()).toBeVisible();
    },
  },
  {
    name: 'the keyboard shortcuts',
    open: async (page) => {
      await openTeam(page);
      await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    },
  },
  {
    name: 'the team while loading',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/console/team',
        () => undefined,
      );
      await page.goto('/northfield/team');
      await expect(page.getByRole('status').filter({ hasText: 'Loading the team' })).toBeVisible();
    },
  },
  {
    name: 'the team that could not be loaded',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/console/team',
        (route) =>
          route.fulfill({
            status: busy.status,
            contentType: 'application/json',
            body: JSON.stringify(busy.body),
          }),
      );
      await page.goto('/northfield/team');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the team for someone without the permission',
    stub: (page) => stubTeam(page, {}, {}, ['platform.settings.manage']),
    open: async (page) => {
      await page.goto('/northfield/team');
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot manage the team' }),
      ).toBeVisible();
    },
  },
];

const invitationStates: State[] = [
  {
    name: 'the invitation page, signed out',
    stub: (page) => stubApi(page, { 'GET /auth/session': signedOut }),
    open: async (page) => {
      await page.goto(`/northfield/invitation#token=${TOKEN}`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Join Northfield Foundation' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the invitation page, signed in',
    stub: (page) =>
      stubApi(page, {
        'GET /auth/session': { status: 200, body: consoleSession({ active: null }) },
      }),
    open: async (page) => {
      await page.goto(`/northfield/invitation#token=${TOKEN}`);
      await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible();
    },
  },
  {
    name: 'the invitation page, signed in with the authenticator app still to set up',
    stub: (page) =>
      stubApi(page, {
        'GET /auth/session': { status: 200, body: consoleSession({ mfa: 'enrol' }) },
      }),
    open: async (page) => {
      await page.goto(`/northfield/invitation#token=${TOKEN}`);
      await expect(page.getByRole('link', { name: 'Set up your authenticator app' })).toBeVisible();
    },
  },
  {
    name: 'the invitation page after a refused token',
    stub: (page) =>
      stubApi(page, {
        'GET /auth/session': { status: 200, body: consoleSession({ active: null }) },
        'POST /auth/invitations/accept': problem(404, 'Not found.'),
      }),
    open: async (page) => {
      await page.goto(`/northfield/invitation#token=${TOKEN}`);
      await page.getByRole('button', { name: 'Accept invitation' }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'This invitation link is not valid' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the invitation page when accepting failed',
    stub: (page) =>
      stubApi(page, {
        'GET /auth/session': { status: 200, body: consoleSession({ active: null }) },
        'POST /auth/invitations/accept': busy,
      }),
    open: async (page) => {
      await page.goto(`/northfield/invitation#token=${TOKEN}`);
      await page.getByRole('button', { name: 'Accept invitation' }).click();
      await expect(
        page.getByText('The service is busy. Try again in a minute.').first(),
      ).toBeVisible();
    },
  },
  {
    name: 'the invitation page with no token',
    stub: (page) => stubApi(page, { 'GET /auth/session': signedOut }),
    open: async (page) => {
      await page.goto('/northfield/invitation');
      await expect(
        page.getByRole('heading', { level: 1, name: 'This invitation link is not valid' }),
      ).toBeVisible();
    },
  },
  {
    name: 'the invitation page when the session could not be read',
    stub: (page) => stubApi(page, { 'GET /auth/session': busy }),
    open: async (page) => {
      await page.goto(`/northfield/invitation#token=${TOKEN}`);
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
];

for (const variant of variants) {
  test.describe(`at ${variant.name}`, () => {
    test.use({
      viewport: variant.viewport,
      deviceScaleFactor: variant.deviceScaleFactor,
      colorScheme: variant.scheme,
    });

    for (const state of [...teamStates, ...invitationStates]) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await (state.stub ?? ((target) => stubTeam(target)))(page);
        await state.open(page);
        // A dialog hides the page behind it from the accessibility tree, but the page still has its one heading.
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
