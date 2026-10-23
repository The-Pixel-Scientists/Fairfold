// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The team screens in a real browser, with the API's answers stubbed
// (team-api.ts): a team that keeps what an administrator does to it, and asks
// for step-up until they confirm it is them. The same steps run against the
// real API in team-journey.spec.ts. Every spec also fails on a Content
// Security Policy violation, so the screens are checked under the production
// policy in console-production.

import { expect, test } from '../../../scripts/e2e/fixtures.ts';

import { consoleSession, problem, signedOut, stubApi } from './auth-api.ts';
import { stubTeam } from './team-api.ts';
import {
  confirmItsYou,
  h1,
  invitationsTable,
  memberRow,
  membersTable,
  openTeam,
  sendInvitation,
  status,
  suspendMember,
} from './team-steps.ts';

const SUFFIX = '– Fairfold Grants console';
const TOKEN = 'tok_0123456789abcdefghijklmnopqrstuvwxyz';

test.describe('the team page', () => {
  test('opens from the navigation, with focus on the heading, and lists the team', async ({
    page,
  }) => {
    await stubTeam(page);
    await page.goto('/northfield/settings');
    await openTeam(page);

    await expect(page).toHaveTitle(`Team ${SUFFIX}`);
    await expect(page).toHaveURL(/\/northfield\/team$/);
    await expect(membersTable(page).getByRole('row')).toHaveCount(4);
    await expect(memberRow(page, /Ada Morgan/)).toContainText('You');
    await expect(memberRow(page, /Ada Morgan/).getByRole('button')).toHaveCount(0);
    await expect(memberRow(page, /Marcus Bell/)).toContainText('Programme manager');
    await expect(memberRow(page, /priya@example.org/)).toContainText('Suspended');
    await expect(invitationsTable(page)).toContainText('fatima@example.org');
    await expect(invitationsTable(page)).toContainText('4 November 2026, 5:00pm');
  });

  test('says how to invite someone when nobody is waiting', async ({ page }) => {
    await stubTeam(page, { invitations: [] });
    await page.goto('/northfield/team');

    await expect(
      page.getByRole('heading', { level: 3, name: 'No invitations waiting' }),
    ).toBeVisible();
    await expect(page.getByText(/enter their email address and pick their roles/)).toBeVisible();
  });

  test('invites someone, confirming it is them first, and names the address', async ({ page }) => {
    const stub = await stubTeam(page);
    await page.goto('/northfield/team');
    await expect(membersTable(page)).toBeVisible();

    await sendInvitation(page, 'new@example.org', 'programme_manager');
    await confirmItsYou(page, 'correct horse battery', '123456');

    await expect(status(page)).toHaveText(
      'Invitation sent to new@example.org. It works for 7 days.',
    );
    await expect(invitationsTable(page)).toContainText('new@example.org');
    expect(stub.sent.filter(({ key }) => !key.startsWith('GET ')).map(({ key }) => key)).toEqual([
      'POST /console/team/invitations',
      'POST /auth/step-up',
      'POST /console/team/invitations',
    ]);
    expect(stub.sent.find(({ key }) => key === 'POST /auth/step-up')?.body).toEqual({
      password: 'correct horse battery',
      code: '123456',
    });
  });

  test('brings the invitation back, with what was typed, when they cancel the step-up', async ({
    page,
  }) => {
    const stub = await stubTeam(page);
    await page.goto('/northfield/team');

    await sendInvitation(page, 'new@example.org', 'reviewer');
    const stepUp = page.getByRole('dialog', { name: 'Confirm it is you' });
    await stepUp.getByRole('button', { name: 'Cancel' }).click();

    const invite = page.getByRole('dialog', { name: 'Invite someone' });
    await expect(invite.getByLabel('Email address')).toHaveValue('new@example.org');
    expect(stub.invitations).toHaveLength(1);
  });

  test('says what to fix in the invitation, beside the fields', async ({ page }) => {
    await stubTeam(page);
    await page.goto('/northfield/team');

    await page.getByRole('button', { name: 'Invite someone' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Invite someone' });
    await dialog.getByLabel('Email address').fill('nobody');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();

    await expect(dialog.getByText('Choose at least one role.').first()).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test('changes roles, suspends, reinstates and removes, each after a confirmation', async ({
    page,
  }) => {
    await stubTeam(page, { recent: true });
    await page.goto('/northfield/team');
    await expect(membersTable(page)).toBeVisible();

    await memberRow(page, /Marcus Bell/)
      .getByRole('button', { name: 'Change roles for Marcus Bell' })
      .click();
    const roles = page.getByRole('dialog', { name: 'Change roles for Marcus Bell' });
    await roles.getByRole('checkbox', { name: /^Administrator/ }).check();
    await roles.getByRole('button', { name: 'Save roles' }).click();
    await expect(status(page)).toHaveText(
      'Roles changed for Marcus Bell: Administrator, Programme manager, Reviewer.',
    );

    await suspendMember(page, 'Marcus Bell');
    await expect(status(page)).toHaveText('Marcus Bell is suspended and signed out.');
    await expect(memberRow(page, /Marcus Bell/)).toContainText('Suspended');

    await memberRow(page, /Marcus Bell/)
      .getByRole('button', { name: 'Reinstate for Marcus Bell' })
      .click();
    await page.getByRole('button', { name: 'Reinstate Marcus Bell' }).click();
    await expect(status(page)).toHaveText('Marcus Bell can sign in again.');
    await expect(memberRow(page, /Marcus Bell/)).toContainText('Active');

    await memberRow(page, /Marcus Bell/)
      .getByRole('button', { name: 'Remove for Marcus Bell' })
      .click();
    const remove = page.getByRole('dialog', { name: 'Remove Marcus Bell from the team?' });
    await expect(remove).toContainText('They will be signed out of Northfield Foundation now');
    await remove.getByRole('button', { name: 'Remove Marcus Bell' }).click();
    await expect(status(page)).toHaveText('Marcus Bell is removed from the team and signed out.');
    await expect(memberRow(page, /Marcus Bell/)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Members' })).toBeFocused();
  });

  test('revokes an invitation', async ({ page }) => {
    await stubTeam(page, { recent: true });
    await page.goto('/northfield/team');

    await page.getByRole('button', { name: 'Revoke invitation to fatima@example.org' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke invitation' }).click();

    await expect(status(page)).toHaveText('The invitation to fatima@example.org is revoked.');
    await expect(
      page.getByRole('heading', { level: 3, name: 'No invitations waiting' }),
    ).toBeVisible();
  });

  test('works from the keyboard: a row opens its roles, and Escape gives focus back to it', async ({
    page,
  }) => {
    await stubTeam(page, { recent: true });
    await page.goto('/northfield/team');
    const row = memberRow(page, /Marcus Bell/);
    await row.focus();

    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Change roles for Marcus Bell' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(row).toBeFocused();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });

  test('tells someone without the permission', async ({ page }) => {
    await stubTeam(page, {}, {}, ['platform.settings.manage']);
    await page.goto('/northfield/team');

    await expect(
      page.getByRole('heading', { level: 2, name: 'You cannot manage the team' }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Team' }),
    ).toHaveCount(0);
  });

  test('says why the team could not load, and tries again', async ({ page }) => {
    await stubTeam(page);
    let failing = true;
    await page.route(
      (url) => url.pathname === '/api/console/team',
      async (route) => {
        if (!failing) return route.fallback();
        const busy = problem(503, 'The service is busy. Try again in a minute.');
        return route.fulfill({
          status: busy.status,
          contentType: 'application/json',
          body: JSON.stringify(busy.body),
        });
      },
    );
    await page.goto('/northfield/team');
    await expect(page.getByText('The service is busy. Try again in a minute.')).toBeVisible();

    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(membersTable(page)).toBeVisible();
  });
});

test.describe('the invitation page', () => {
  test('signed out, explains what to do first, and keeps the token in the page only', async ({
    page,
  }) => {
    const sent = await stubApi(page, { 'GET /auth/session': signedOut });
    await page.goto(`/northfield/invitation#token=${TOKEN}`);

    await expect(h1(page, 'Join Northfield Foundation')).toBeVisible();
    await expect(page.getByText(/create an account or sign in/)).toBeVisible();
    await expect(page.getByText(/open the link in your invitation email again/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/northfield/sign-up',
    );
    await expect(page).toHaveURL(/\/northfield\/invitation$/);
    await expect(page).toHaveTitle(`Accept your invitation ${SUFFIX}`);
    expect(sent.filter(({ key }) => !key.startsWith('GET '))).toEqual([]);
  });

  test('signed in, accepts and opens the console', async ({ page }) => {
    let accepted = false;
    const sent = await stubApi(page, {
      'GET /auth/session': () => ({
        status: 200,
        body: consoleSession(accepted ? {} : { active: null }),
      }),
      'POST /auth/invitations/accept': () => {
        accepted = true;
        return { status: 200, body: consoleSession() };
      },
    });
    await page.goto(`/northfield/invitation#token=${TOKEN}`);

    await expect(h1(page, 'Accept your invitation')).toBeVisible();
    await expect(page.getByText('ada@example.org')).toBeVisible();
    await page.getByRole('button', { name: 'Accept invitation' }).click();

    await expect(h1(page, 'Programmes')).toBeVisible();
    await expect(page).toHaveURL(/\/northfield\/$/);
    expect(sent.find(({ key }) => key === 'POST /auth/invitations/accept')?.body).toEqual({
      token: TOKEN,
    });
  });

  test('says the link is not valid when the token is refused', async ({ page }) => {
    await stubApi(page, {
      'GET /auth/session': { status: 200, body: consoleSession({ active: null }) },
      'POST /auth/invitations/accept': problem(404, 'Not found.'),
    });
    await page.goto(`/northfield/invitation#token=${TOKEN}`);

    await page.getByRole('button', { name: 'Accept invitation' }).click();

    await expect(h1(page, 'This invitation link is not valid')).toBeFocused();
    await expect(
      page.getByText(/Ask the person who invited you for a new invitation/),
    ).toBeVisible();
  });
});
