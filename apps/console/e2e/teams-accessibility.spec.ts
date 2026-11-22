// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Axe checks for the teams page, a team and each of their states and dialogs,
// at desktop width, at 320 px wide and at 200% zoom (ADR 0006), and at
// desktop width in the dark scheme, with the API's answers stubbed
// (teams-api.ts). In console-production they run under the production content
// security policy.

import { expect as strictExpect, test } from '../../../scripts/e2e/fixtures.ts';
import type { Page } from '@playwright/test';

import { problem } from './auth-api.ts';
import { expectNoHorizontalScroll, expectNoViolations, variants } from './auth-axe.ts';
import { casework, legacy, stubTeams } from './teams-api.ts';

/** Each page loads its code when first opened, which a busy machine or a development server's first compile can slow past five seconds. */
const expect = strictExpect.configure({ timeout: 15_000 });

const busy = problem(503, 'The service is busy. Try again in a minute.');

interface State {
  name: string;
  /** Sets the API's answers for this state. */
  stub?: (page: Page) => Promise<unknown>;
  /** Opens the screen, gets it into the state, and waits until it is showing. */
  open: (page: Page) => Promise<void>;
}

const openTeams = async (page: Page) => {
  await page.goto('/northfield/teams');
  await expect(page.getByRole('table', { name: 'Teams' })).toBeVisible();
};

const openTeam = async (page: Page) => {
  await page.goto(`/northfield/teams/${casework.id}`);
  await expect(page.getByRole('table', { name: 'Members of Casework' })).toBeVisible();
};

const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

const states: State[] = [
  { name: 'the teams page', open: openTeams },
  {
    name: 'the teams page with archived teams shown',
    open: async (page) => {
      await openTeams(page);
      await page.getByRole('checkbox', { name: 'Show archived teams' }).check();
      await expect(page.getByText('Legacy panel')).toBeVisible();
    },
  },
  {
    name: 'the teams page with no teams',
    stub: (page) => stubTeams(page, { teams: [] }),
    open: async (page) => {
      await page.goto('/northfield/teams');
      await expect(page.getByRole('heading', { level: 2, name: 'No teams yet' })).toBeVisible();
    },
  },
  {
    name: 'the teams page after a change',
    stub: (page) => stubTeams(page, { recent: true }),
    open: async (page) => {
      await openTeams(page);
      await page.getByRole('button', { name: 'Rename Casework' }).click();
      await dialog(page, 'Rename Casework').getByLabel('Team name').fill('Case team');
      await page.getByRole('button', { name: 'Rename team' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Team renamed' })).toBeVisible();
    },
  },
  {
    name: 'the create team dialog',
    open: async (page) => {
      await openTeams(page);
      await page.getByRole('button', { name: 'Create team' }).click();
      await expect(dialog(page, 'Create team')).toBeVisible();
    },
  },
  {
    name: 'the create team dialog with a problem to fix',
    open: async (page) => {
      await openTeams(page);
      await page.getByRole('button', { name: 'Create team' }).click();
      await dialog(page, 'Create team').getByRole('button', { name: 'Create team' }).click();
      await expect(
        dialog(page, 'Create team').getByText('Enter a team name.').first(),
      ).toBeVisible();
    },
  },
  {
    name: 'the rename dialog',
    open: async (page) => {
      await openTeams(page);
      await page.getByRole('button', { name: 'Rename Casework' }).click();
      await expect(dialog(page, 'Rename Casework')).toBeVisible();
    },
  },
  {
    name: 'the archive confirmation',
    open: async (page) => {
      await openTeams(page);
      await page.getByRole('button', { name: 'Archive Casework' }).click();
      await expect(dialog(page, 'Archive Casework?')).toBeVisible();
    },
  },
  {
    name: 'the step-up dialog',
    open: async (page) => {
      await openTeams(page);
      await page.getByRole('button', { name: 'Archive Casework' }).click();
      await dialog(page, 'Archive Casework?').getByRole('button', { name: 'Archive team' }).click();
      await expect(dialog(page, 'Confirm it is you')).toBeVisible();
    },
  },
  {
    name: 'a confirmation that the API refused',
    stub: (page) =>
      stubTeams(page, { recent: true }).then(() =>
        page.route(
          (url) => url.pathname.endsWith('/archive'),
          (route) =>
            route.fulfill({
              status: busy.status,
              contentType: 'application/json',
              body: JSON.stringify(busy.body),
            }),
        ),
      ),
    open: async (page) => {
      await openTeams(page);
      await page.getByRole('button', { name: 'Archive Casework' }).click();
      await dialog(page, 'Archive Casework?').getByRole('button', { name: 'Archive team' }).click();
      await expect(dialog(page, 'Archive Casework?').getByRole('alert')).toContainText(
        'The service is busy',
      );
    },
  },
  {
    name: 'the teams page while loading',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/console/teams',
        () => undefined,
      );
      await page.goto('/northfield/teams');
      await expect(page.getByRole('status').filter({ hasText: 'Loading teams' })).toBeVisible();
    },
  },
  {
    name: 'the teams page that could not be loaded',
    open: async (page) => {
      await page.route(
        (url) => url.pathname === '/api/console/teams',
        (route) =>
          route.fulfill({
            status: busy.status,
            contentType: 'application/json',
            body: JSON.stringify(busy.body),
          }),
      );
      await page.goto('/northfield/teams');
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    },
  },
  {
    name: 'the teams page for someone without the permission',
    stub: (page) => stubTeams(page, {}, {}, ['platform.settings.manage']),
    open: async (page) => {
      await page.goto('/northfield/teams');
      await expect(
        page.getByRole('heading', { level: 2, name: 'You cannot manage teams' }),
      ).toBeVisible();
    },
  },
  { name: 'a team', open: openTeam },
  {
    name: 'a team with no members',
    stub: (page) => stubTeams(page, { teams: [{ ...casework, members: [] }] }),
    open: async (page) => {
      await page.goto(`/northfield/teams/${casework.id}`);
      await expect(page.getByRole('heading', { name: 'No one is in this team' })).toBeVisible();
    },
  },
  {
    name: 'an archived team',
    stub: (page) => stubTeams(page, { teams: [{ ...legacy, members: [...casework.members] }] }),
    open: async (page) => {
      await page.goto(`/northfield/teams/${legacy.id}`);
      await expect(page.getByText('This team is archived')).toBeVisible();
    },
  },
  {
    name: 'the add member dialog',
    open: async (page) => {
      await openTeam(page);
      await page.getByRole('button', { name: 'Add member' }).click();
      await expect(dialog(page, 'Add a member to Casework')).toBeVisible();
    },
  },
  {
    name: 'the add member dialog with a problem to fix',
    open: async (page) => {
      await openTeam(page);
      await page.getByRole('button', { name: 'Add member' }).click();
      const add = dialog(page, 'Add a member to Casework');
      await add.getByRole('button', { name: 'Add member' }).click();
      await expect(add.getByText('Choose a member to add.').first()).toBeVisible();
    },
  },
  {
    name: 'the remove confirmation',
    open: async (page) => {
      await openTeam(page);
      await page.getByRole('button', { name: 'Remove from team for Ada Morgan' }).click();
      await expect(dialog(page, 'Remove Ada Morgan from Casework?')).toBeVisible();
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

    for (const state of states) {
      test(`@a11y ${state.name} has no axe violations`, async ({ page }) => {
        await (state.stub ?? ((target) => stubTeams(target)))(page);
        await state.open(page);
        // A dialog hides the page behind it from the accessibility tree, but the page still has its one heading.
        await expect(page.locator('h1')).toHaveCount(1);

        await expectNoViolations(page);
        await expectNoHorizontalScroll(page);
      });
    }
  });
}
