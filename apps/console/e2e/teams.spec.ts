// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The teams screens in a real browser, with the API's answers stubbed
// (teams-api.ts): teams that keep what an administrator does to them and ask
// for step-up until they confirm it is them. Every spec also fails on a
// Content Security Policy violation, so the screens are checked under the
// production policy in console-production.

import type { Page } from '@playwright/test';

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { confirmItsYou } from './team-steps.ts';
import { casework, stubTeams } from './teams-api.ts';

const SUFFIX = '– Fairfold Grants console';
const written = (sent: { key: string }[]) =>
  sent.map(({ key }) => key).filter((key) => !key.startsWith('GET '));

const teamsTable = (page: Page) => page.getByRole('table', { name: 'Teams' });
const said = (page: Page) => page.getByRole('status').filter({ hasText: /\S/ });
/** The button that opened a dialog has gone with the change, so focus must not fall to the page. */
const focusKept = (page: Page) => expect(page.locator('body')).not.toBeFocused();

test.describe('the teams page', () => {
  test('lists teams with member counts and hides archived ones until asked', async ({ page }) => {
    await stubTeams(page);
    await page.goto('/northfield/teams');

    await expect(page).toHaveTitle(`Teams ${SUFFIX}`);
    await expect(teamsTable(page).getByRole('row', { name: /Casework/ })).toContainText('2');
    await expect(page.getByText('Legacy panel')).toBeHidden();
    await page.getByRole('checkbox', { name: 'Show archived teams' }).check();
    await expect(teamsTable(page).getByRole('row', { name: /Legacy panel/ })).toContainText(
      'Archived',
    );
  });

  test('says what a team is for when there are none', async ({ page }) => {
    await stubTeams(page, { teams: [] });
    await page.goto('/northfield/teams');

    await expect(page.getByRole('heading', { level: 2, name: 'No teams yet' })).toBeVisible();
    await expect(page.getByText(/group of members that records can be assigned to/)).toBeVisible();
  });

  test('creates a team, confirming it is them first', async ({ page }) => {
    const stub = await stubTeams(page);
    await page.goto('/northfield/teams');

    await page.getByRole('button', { name: 'Create team' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create team' });
    await dialog.getByLabel('Team name').fill('Safeguarding');
    await dialog.getByRole('button', { name: 'Create team' }).click();
    await confirmItsYou(page, 'correct horse battery', '123456');

    await expect(said(page)).toHaveText('Team Safeguarding created. It has no members yet.');
    await expect(teamsTable(page)).toContainText('Safeguarding');
    expect(written(stub.sent)).toEqual([
      'POST /console/teams',
      'POST /auth/step-up',
      'POST /console/teams',
    ]);
  });

  test('shows a name that is already used beside the field', async ({ page }) => {
    await stubTeams(page, { recent: true });
    await page.goto('/northfield/teams');

    await page.getByRole('button', { name: 'Create team' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create team' });
    await dialog.getByLabel('Team name').fill('Casework');
    await dialog.getByRole('button', { name: 'Create team' }).click();
    await expect(dialog.getByText('Choose a name no active team uses.').first()).toBeVisible();
  });

  test('renames and archives a team', async ({ page }) => {
    await stubTeams(page, { recent: true });
    await page.goto('/northfield/teams');

    await page.getByRole('button', { name: 'Rename Casework' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename Casework' });
    await rename.getByLabel('Team name').fill('Case team');
    await rename.getByRole('button', { name: 'Rename team' }).click();
    await expect(teamsTable(page)).toContainText('Case team');

    await page.getByRole('button', { name: 'Archive Case team' }).click();
    const archive = page.getByRole('dialog', { name: 'Archive Case team?' });
    await archive.getByRole('button', { name: 'Archive team' }).click();
    await expect(said(page)).toHaveText('Team Case team is archived.');
    await expect(said(page)).toBeFocused();
    await focusKept(page);
  });

  test('tells someone without the permission', async ({ page }) => {
    await stubTeams(page, {}, {}, ['platform.settings.manage']);
    await page.goto('/northfield/teams');
    await expect(
      page.getByRole('heading', { level: 2, name: 'You cannot manage teams' }),
    ).toBeVisible();
  });
});

test.describe('a team', () => {
  test('adds a member by name and role, and removes one saying what changes', async ({ page }) => {
    const stub = await stubTeams(page, { recent: true });
    await page.goto(`/northfield/teams/${casework.id}`);

    const members = page.getByRole('table', { name: 'Members of Casework' });
    await expect(members).toContainText('Ada Morgan');
    await expect(page.getByRole('main')).not.toContainText('@example.org');

    await page.getByRole('button', { name: 'Add member' }).click();
    const add = page.getByRole('dialog', { name: 'Add a member to Casework' });
    await add
      .getByLabel('Member')
      .selectOption({ label: 'Marcus Bell (Programme manager, Reviewer)' });
    await add.getByRole('button', { name: 'Add member' }).click();
    await expect(members).toContainText('Marcus Bell');

    await page.getByRole('button', { name: 'Remove from team for Marcus Bell' }).click();
    const remove = page.getByRole('dialog', { name: 'Remove Marcus Bell from Casework?' });
    await expect(remove).toContainText(
      'Marcus Bell will no longer see records assigned to Casework.',
    );
    await remove.getByRole('button', { name: 'Remove from team' }).click();
    await expect(members).not.toContainText('Marcus Bell');
    await expect(said(page)).toBeFocused();
    await focusKept(page);
    expect(written(stub.sent).filter((key) => key.includes('/members/'))).toHaveLength(2);
  });

  test('says the page was not found for a team out of reach', async ({ page }) => {
    await stubTeams(page);
    await page.goto('/northfield/teams/00000000-0000-4000-8000-000000000999');
    await expect(page.getByText('This page was not found.')).toBeVisible();
  });
});
